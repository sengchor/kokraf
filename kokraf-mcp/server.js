#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { EditorBridge } from './bridge.js';
import { PeerHub, PeerClient, isAddrInUse } from './peer.js';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.KOKRAF_BRIDGE_PORT ?? 7331);
const PEER_PORT = Number(process.env.KOKRAF_PEER_PORT ?? PORT + 1);
const TOKEN = process.env.KOKRAF_BRIDGE_TOKEN ?? null;
const CALL_TIMEOUT = Number(process.env.KOKRAF_CALL_TIMEOUT ?? 20000);
const MAX_RESULT_CHARS = 100_000;

const log = (msg) => process.stderr.write(`[kokraf-mcp ${process.pid}] ${msg}\n`);

/* ------------------------------------------------------------------ *
 * command manifest cache
 *
 * Most MCP clients call tools/list once, right after connecting, and ignore
 * tools/list_changed afterwards. The editor always connects later than that,
 * so tools registered from system.describe arrive too late to be seen.
 * Caching the last known command list lets the next session register those
 * tools up front, before the client asks.
 * ------------------------------------------------------------------ */

const MANIFEST_DIR = process.env.KOKRAF_MCP_CACHE ?? join(homedir(), '.kokraf-mcp');
const MANIFEST_PATH = join(MANIFEST_DIR, 'commands.json');

function loadManifest() {
  try {
    const commands = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    return Array.isArray(commands) ? commands : [];
  } catch {
    return [];
  }
}

function saveManifest(commands) {
  try {
    mkdirSync(MANIFEST_DIR, { recursive: true });
    // Write-then-rename so two sessions saving at once can't leave half a file.
    const tmp = `${MANIFEST_PATH}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(commands, null, 2));
    renameSync(tmp, MANIFEST_PATH);
  } catch (err) {
    log(`could not save command manifest: ${err.message}`);
  }
}

function zodForSpec(spec) {
  if (spec.enum) return z.enum(spec.enum);

  const names = Array.isArray(spec.type) ? spec.type : String(spec.type ?? 'any').split('|');

  const parts = names.map((name) => {
    switch (name.trim()) {
      case 'number':
        return z.number();
      case 'string':
        return z.string();
      case 'boolean':
        return z.boolean();
      case 'vec3':
        return z.array(z.number()).length(3);
      case 'string[]':
        return z.array(z.string());
      default:
        return z.any();
    }
  });

  return parts.length === 1 ? parts[0] : z.union(parts);
}

/**
 * Defaults stay in CommandRegistry._validate rather than being duplicated in
 * zod — one source of truth. They're only mentioned in the description so the
 * model knows what it gets when it omits a parameter.
 */
function toInputSchema(params = {}) {
  const shape = {};

  for (const [key, spec] of Object.entries(params)) {
    let field = zodForSpec(spec);

    const notes = [spec.description];
    if ('default' in spec) notes.push(`Default: ${JSON.stringify(spec.default)}.`);
    const description = notes.filter(Boolean).join(' ');
    if (description) field = field.describe(description);

    shape[key] = 'default' in spec || spec.optional ? field.optional() : field;
  }

  return shape;
}

const toolNameFor = (command) => `kokraf_${command.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

/* ------------------------------------------------------------------ *
 * wiring
 * ------------------------------------------------------------------ */

const bridge = new EditorBridge({ port: PORT, token: TOKEN, log });

const AXES_INSTRUCTIONS =
  'Kokraf uses a Z-up coordinate system: +X front, +Y right, +Z up. ' +
  'This is NOT the three.js Y-up convention, even though the editor is built on three.js. ' +
  'Every position, rotation, scale and pivot sent to or returned by Kokraf tools is Z-up. ' +
  '"Up" means +Z; "move up by 1" is translate [0, 0, 1].';

const mcp = new McpServer(
  { name: 'kokraf', version: '0.1.0' },
  { capabilities: { tools: { listChanged: true } }, instructions: AXES_INSTRUCTIONS }
);

const registered = new Set();

/**
 * role:
 *   'leader'    — this process owns PORT; the editor connects here directly,
 *                 and other sessions reach the editor through our PeerHub.
 *   'follower'  — another kokraf-mcp owns PORT; we forward calls to its hub.
 *   'searching' — neither yet; an election is scheduled.
 */
let role = 'searching';
let hub = null;
let peer = null;
let bridgeError = null;
let editorInfo = null;

async function call(method, params, timeout = CALL_TIMEOUT) {
  if (role === 'leader') return bridge.call(method, params, timeout);
  if (role === 'follower' && peer?.open) return peer.call(method, params, timeout);
  throw new Error(bridgeError ?? 'Not connected to the Kokraf bridge yet; try again in a few seconds.');
}

function resultToContent(result) {
  // Lets a future screenshot command return an image without touching this file.
  if (result && typeof result === 'object' && result.__image) {
    const { data, mimeType = 'image/png', caption } = result.__image;
    const content = [{ type: 'image', data, mimeType }];
    if (caption) content.push({ type: 'text', text: caption });
    return content;
  }

  let text = typeof result === 'string' ? result : JSON.stringify(result ?? null, null, 2);

  if (text.length > MAX_RESULT_CHARS) {
    text = `${text.slice(0, MAX_RESULT_CHARS)}\n\n[truncated — narrow the request, e.g. with maxObjects or root]`;
  }

  return [{ type: 'text', text }];
}

const tools = new Map();

function registerCommandTool(command) {
  const description = command.mutates
    ? `${command.description} (Modifies the scene; undoable with kokraf_undo or Ctrl+Z in the editor.)`
    : command.description;
  const signature = JSON.stringify([description, command.params]);

  const existing = tools.get(command.name);
  if (existing) {
    if (existing.signature === signature) return;
    existing.handle.update({ description, paramsSchema: toInputSchema(command.params) });
    existing.signature = signature;
    log(`updated tool ${toolNameFor(command.name)}`);
    return;
  }

  const handle = mcp.registerTool(
    toolNameFor(command.name),
    { title: command.name, description, inputSchema: toInputSchema(command.params) },
    async (args = {}) => {
      try {
        const params = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
        const result = await call(command.name, params, CALL_TIMEOUT);
        return { content: resultToContent(result) };
      } catch (err) {
        return { isError: true, content: [{ type: 'text', text: err.message }] };
      }
    }
  );
  tools.set(command.name, { handle, signature });
}

async function syncTools() {
  try {
    const info = await call('system.describe', {}, 5000);
    editorInfo = info;
    for (const command of info.commands ?? []) registerCommandTool(command);
    if (info.commands?.length) saveManifest(info.commands);
    log(`editor ready (${role}): ${info.commands?.length ?? 0} commands, project "${info.projectName ?? 'untitled'}"`);
    return info;
  } catch (err) {
    log(`could not describe editor: ${err.message}`);
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * election: first process to bind PORT leads, the rest follow
 * ------------------------------------------------------------------ */

let electTimer = null;

function scheduleElection(delay) {
  clearTimeout(electTimer);
  electTimer = setTimeout(() => {
    elect().catch((err) => {
      bridgeError = `Bridge failed to start: ${err.message}`;
      log(bridgeError);
      scheduleElection(5000);
    });
  }, delay);
}

async function elect() {
  try {
    await bridge.start();
  } catch (err) {
    if (!isAddrInUse(err)) throw err;
    await becomeFollower();
    return;
  }

  hub = new PeerHub({
    port: PEER_PORT,
    token: TOKEN,
    log,
    call: (method, params, timeout) => bridge.call(method, params, timeout ?? CALL_TIMEOUT),
  });

  try {
    await hub.start();
  } catch (err) {
    hub = null;
    log(`peer port ${PEER_PORT} unavailable (${err.message}); other sessions can't share the editor`);
  }

  role = 'leader';
  bridgeError = null;
  log(`leader: owns editor port ${PORT}${hub ? `, sharing on ${PEER_PORT}` : ''}`);

  if (bridge.connected) await syncTools();
}

async function becomeFollower() {
  peer?.close();
  peer = new PeerClient({ port: PEER_PORT, token: TOKEN, log });

  peer.onEvent = (event) => {
    if (event === 'editor:connected') syncTools();
  };

  peer.onClose = () => {
    role = 'searching';
    bridgeError = 'The kokraf-mcp session that owned the editor went away; taking over…';
    log(bridgeError);
    // Jitter so several followers don't stampede the port at once.
    scheduleElection(300 + Math.random() * 700);
  };

  try {
    await peer.connect();
  } catch {
    // Port is taken but nothing shares it — e.g. an older kokraf-mcp without
    // a peer hub. Keep retrying; we'll take over when it exits.
    role = 'searching';
    bridgeError =
      `Port ${PORT} is owned by another process with no peer hub on ${PEER_PORT} ` +
      '(probably an older kokraf-mcp). Retrying; close that session to hand the editor over.';
    log(bridgeError);
    scheduleElection(3000);
    return;
  }

  role = 'follower';
  bridgeError = null;
  log(`follower: reaching the editor through port ${PEER_PORT}`);
  await syncTools();
}

bridge.on('editor:connected', async () => {
  await syncTools();
  hub?.broadcast('editor:connected');
});

/* ------------------------------------------------------------------ *
 * always-available status tool
 * ------------------------------------------------------------------ */

const textContent = (text) => ({ content: [{ type: 'text', text }] });

mcp.registerTool(
  'kokraf_status',
  {
    title: 'kokraf status',
    description:
      'Check whether the Kokraf editor is reachable from this session, and which project is open. ' +
      'Call this first if another Kokraf tool reports that the editor is unavailable.',
    inputSchema: {},
  },
  async () => {
    if (role === 'searching') {
      return textContent(bridgeError ?? 'Starting up; try again in a few seconds.');
    }

    // Also registers any command tools we haven't seen yet.
    const info = await syncTools();

    if (!info) {
      return textContent(
        `No editor connected (this session is the ${role}; editor port ${PORT}).\n` +
          'Open the Kokraf editor and confirm the agent bridge is enabled ' +
          "(localStorage 'kokraf.agent' = 'on' outside localhost)."
      );
    }

    return textContent(
      JSON.stringify(
        {
          connected: true,
          role,
          port: PORT,
          project: info.projectName ?? null,
          projectId: info.projectId ?? null,
          url: info.url ?? null,
          commands: [...registered],
        },
        null,
        2
      )
    );
  }
);

/* ------------------------------------------------------------------ *
 * static tools — present in the very first tools/list, so they work even
 * in clients that never refresh the tool list mid-session
 * ------------------------------------------------------------------ */

mcp.registerTool(
  'kokraf_commands',
  {
    title: 'kokraf commands',
    description:
      'List every command the connected Kokraf editor supports, with parameter names, types, ' +
      'defaults and whether it modifies the scene. Use with kokraf_run.',
    inputSchema: {},
  },
  async () => {
    const info = await syncTools();
    if (!info) {
      return {
        isError: true,
        content: [{ type: 'text', text: bridgeError ?? 'No editor connected. Call kokraf_status for details.' }],
      };
    }
    return textContent(JSON.stringify(info.commands ?? [], null, 2));
  }
);

mcp.registerTool(
  'kokraf_run',
  {
    title: 'kokraf run',
    description:
      'Run any Kokraf editor command by name, e.g. command "scene.outline" or "object.transform". ' +
      'Call kokraf_commands first to see the available commands and their parameters. ' +
      'Parameters are validated by the editor, and invalid ones return an error naming the valid set. ' +
      'Commands that modify the scene are undoable with Ctrl+Z in the editor.',
    inputSchema: {
      command: z.string().describe('Command name exactly as listed by kokraf_commands.'),
      params: z
        .record(z.string(), z.any())
        .optional()
        .describe('Parameters object for the command. Omit for commands with no required parameters.'),
    },
  },
  async ({ command, params = {} }) => {
    try {
      const result = await call(command, params, CALL_TIMEOUT);
      return { content: resultToContent(result) };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Typed per-command tools from the last session that saw the editor.
// A stale entry is harmless: the editor answers "Unknown command".
for (const command of loadManifest()) registerCommandTool(command);

/* ------------------------------------------------------------------ *
 * lifecycle
 * ------------------------------------------------------------------ */

async function main() {
  await mcp.connect(new StdioServerTransport());
  log('MCP server ready on stdio');
  await elect();
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    clearTimeout(electTimer);
    peer?.close();
    await hub?.stop();
    await bridge.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  log(`fatal: ${err.stack ?? err.message}`);
  process.exit(1);
});