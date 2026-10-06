import "@supabase/functions-js/edge-runtime.d.ts";

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from "@supabase/supabase-js";

type ModelConfig = {
  input: number;      // credits per 1M input tokens
  output: number;     // credits per 1M output tokens
  maxTokens: number;  // output cap per step (thinking counts toward it)
  maxSteps: number;   // Claude calls per user turn before pausing
};

const MODELS: Record<string, ModelConfig> = {
  'claude-haiku-4-5-20251001': { input: 150, output: 750, maxTokens: 8192, maxSteps: 40 },
  'claude-sonnet-5-5': { input: 300, output: 1500, maxTokens: 16384, maxSteps: 70 },
  'claude-opus-5-5': { input: 600, output: 3000, maxTokens: 16384, maxSteps: 100 },
};
const DEFAULT_MODEL = 'claude-sonnet-5-5';

const MIN_BALANCE = 1;
const RESERVE_TOKENS = 2048;

const MAX_TOOLS = 64;
const MAX_TOOL_DESCRIPTION_CHARS = 2000;
const MAX_TOOL_SCHEMA_CHARS = 8000;
const MAX_MESSAGES = 200;
const MAX_BODY_CHARS = 8_000_000;
const MAX_RESULT_CHARS = 100_000;

const CACHE_WRITE_FACTOR = 1.25;
const CACHE_READ_FACTOR = 0.1;

const CONTINUE_SENTINEL = '<continue/>';

const HEARTBEAT_MS = 10_000;

const SYSTEM_PROMPT = `You are the modeling assistant in Kokraf, a web-based 3D editor. You edit the user's open scene with tools.

Kokraf is Z-up: +X front, +Y right, +Z up (not three.js's Y-up). All positions, rotations, scales and pivots are Z-up; "up 1" is [0, 0, 1].

- Inspect before editing (scene_outline, mesh_inspect); don't guess indices or positions.
- One change at a time; check the result, with viewport_capture when the look matters.
- Keep tool inputs small; split large edits across calls.
- If a step goes wrong, editor_undo it instead of stacking fixes.
- If a request is ambiguous in a way that changes the result, ask briefly.
- A user message of only ${CONTINUE_SENTINEL} means you hit the length limit: resume where you stopped.
- When done, say in a sentence or two what changed.`;

/* ------------------------------------------------------------------ */

const ANTHROPIC_API_KEY_DEV = Deno.env.get('ANTHROPIC_API_KEY_DEV');
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY_DEV });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const fail = (status: number, error: string, reason?: string, extra: Record<string, unknown> = {}) =>
  json({ error, reason, ...extra }, status);

/** Error body for use after the 200 has been sent; `status` carries the real code. */
const failBody = (status: number, error: string, reason?: string) => ({ error, reason, status });

type Tool = { name: string; description?: string; input_schema: Record<string, unknown> };

function cleanTools(input: unknown): Tool[] | null {
  if (!Array.isArray(input) || input.length > MAX_TOOLS) return null;
  const tools: Tool[] = [];
  for (const t of input) {
    if (!t || typeof t.name !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(t.name)) return null;
    if (!t.input_schema || typeof t.input_schema !== 'object') return null;
    if (JSON.stringify(t.input_schema).length > MAX_TOOL_SCHEMA_CHARS) return null;
    // Copy only known fields, so the client can't smuggle in other options.
    tools.push({
      name: t.name,
      description: typeof t.description === 'string' ? t.description.slice(0, MAX_TOOL_DESCRIPTION_CHARS) : undefined,
      input_schema: t.input_schema,
    });
  }
  return tools;
}

const isSentinel = (text: unknown) => typeof text === 'string' && text.trim() === CONTINUE_SENTINEL;

/** True if this is a user message the person actually typed (not tool results, not the sentinel). */
function isTypedUserMessage(m: any) {
  if (m?.role !== 'user') return false;
  if (typeof m.content === 'string') return !isSentinel(m.content);
  if (!Array.isArray(m.content)) return false;
  return m.content.some((b: any) => b?.type === 'text' && typeof b.text === 'string' && !isSentinel(b.text));
}

/** Claude calls since the user last typed something. */
function stepsSinceUserText(messages: any[]) {
  let steps = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === 'assistant') steps++;
    else if (isTypedUserMessage(m)) break;
  }
  return steps;
}

const truncate = (text: string) =>
  text.length > MAX_RESULT_CHARS
    ? `${text.slice(0, MAX_RESULT_CHARS)}\n\n[truncated: narrow the request, e.g. with maxObjects or root]`
    : text;

/**
 * Truncates long text tool results. The same result truncates the same way on
 * every request, so a message that was already sent never changes.
 *
 * Images are left alone on purpose: removing or re-encoding an earlier capture
 * edits the conversation prefix, which invalidates Opus's thinking blocks and
 * restarts the prompt cache. Downscale captures before the first send instead.
 */
function truncateToolResults(messages: any[]) {
  const out = structuredClone(messages);
  for (const m of out) {
    if (m?.role !== 'user' || !Array.isArray(m.content)) continue;
    for (const block of m.content) {
      if (block?.type !== 'tool_result') continue;
      if (typeof block.content === 'string') {
        block.content = truncate(block.content);
      } else if (Array.isArray(block.content)) {
        block.content = block.content.map((part: any) =>
          part?.type === 'text' && typeof part.text === 'string' ? { ...part, text: truncate(part.text) } : part,
        );
      }
    }
  }
  return out;
}

/**
 * Cache breakpoint on the newest message, so each step of a tool loop reads
 * the whole earlier conversation from cache instead of paying for it again.
 */
function withCacheBreakpoint(messages: any[]) {
  const out = structuredClone(messages);
  const last = out.at(-1);
  if (!last) return out;
  if (typeof last.content === 'string') last.content = [{ type: 'text', text: last.content }];
  const block = Array.isArray(last.content) ? last.content.at(-1) : null;
  if (block && typeof block === 'object') block.cache_control = { type: 'ephemeral' };
  return out;
}

function creditsFor(rate: ModelConfig, usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null }) {
  const input =
    usage.input_tokens +
    (usage.cache_creation_input_tokens ?? 0) * CACHE_WRITE_FACTOR +
    (usage.cache_read_input_tokens ?? 0) * CACHE_READ_FACTOR;
  const credits = (input * rate.input + usage.output_tokens * rate.output) / 1_000_000;
  return Math.max(1, Math.ceil(credits));
}

/**
 * Sends 200 right away and whitespace every HEARTBEAT_MS until `work` finishes,
 * then the JSON body. Keeps slow Opus steps from tripping the idle timeout.
 * Errors after this point can't change the status code, so they come back as
 * a 200 whose body has `error`, `reason` and `status`.
 */
function heartbeatJson(work: () => Promise<unknown>) {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const timer = setInterval(() => {
        try { controller.enqueue(enc.encode(' ')); } catch { /* client went away */ }
      }, HEARTBEAT_MS);
      let body: unknown;
      try {
        body = await work();
      } catch (err) {
        console.error('agent step failed', err);
        body = failBody(500, 'Something went wrong. Try again.', 'internal_error');
      } finally {
        clearInterval(timer);
      }
      try {
        controller.enqueue(enc.encode(JSON.stringify(body)));
        controller.close();
      } catch { /* client went away */ }
    },
  });
  return new Response(stream, { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return fail(405, 'Use POST.');

  // Who is calling. The gateway already checked the JWT (verify_jwt = true);
  // this resolves it to a user id.
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  const { data: userData, error: userError } = token ? await supabase.auth.getUser(token) : { data: null, error: true };
  const user = userData?.user;
  if (userError || !user) return fail(401, 'Sign in to use the agent.', 'unauthenticated');

  // What they sent.
  const raw = await req.text();
  if (raw.length > MAX_BODY_CHARS) {
    return fail(413, 'This conversation is too long. Start a new chat.', 'too_large');
  }

  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(400, 'Request body is not valid JSON.', 'bad_request');
  }

  const model = body?.model ?? DEFAULT_MODEL;
  if (typeof model !== 'string' || !Object.hasOwn(MODELS, model)) {
    return fail(400, 'Unknown model.', 'model');
  }
  const rate = MODELS[model];

  const tools = cleanTools(body?.tools);
  const messages = body?.messages;
  if (!tools) return fail(400, 'Invalid tool list.', 'bad_request');
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    return fail(400, 'Invalid message list.', 'bad_request');
  }

  // Stop runaway tool loops before they cost anything.
  if (stepsSinceUserText(messages) >= rate.maxSteps) {
    return fail(409, `Paused after ${rate.maxSteps} steps. Send "continue" to keep going.`, 'step_limit');
  }

  // Can they pay for it.
  const { data: balance, error: balanceError } = await supabase.rpc('agent_credit_balance', { p_user: user.id });
  if (balanceError) {
    console.error('balance lookup failed', balanceError);
    return fail(500, 'Could not check your credit balance.', 'balance_error');
  }
  const minBalance = Math.max(MIN_BALANCE, Math.ceil((RESERVE_TOKENS * rate.output) / 1_000_000));
  if (Number(balance) < minBalance) {
    return fail(402, "You've reached your current credit limit.", 'no_credits', { balance: Number(balance) });
  }

  // Ask Claude. Everything from here runs behind the heartbeat.
  return heartbeatJson(async () => {
    let message: Anthropic.Message;
    try {
      // Streaming from Anthropic avoids the SDK's limits on long non-streaming calls.
      message = await anthropic.messages
        .stream({
          model,
          max_tokens: rate.maxTokens,
          // One breakpoint here caches tools + system together, since tools come first.
          system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
          tools: tools as Anthropic.Tool[],
          messages: withCacheBreakpoint(truncateToolResults(messages)),
        })
        .finalMessage();
    } catch (err) {
      if (err instanceof Anthropic.APIError) {
        console.error('anthropic error', err.status, err.message);
        if (err.status === 400) return failBody(400, err.message, 'invalid_conversation');
        if (err.status === 429 || err.status === 529) {
          return failBody(503, 'Claude is busy right now. Try again in a moment.', 'busy');
        }
      } else {
        console.error('anthropic call failed', err);
      }
      return failBody(502, 'Could not reach Claude. Try again.', 'upstream_error');
    }

    // Charge for what was actually used, including any cut-off output.
    const spent = creditsFor(rate, message.usage);
    const { data: newBalance, error: spendError } = await supabase.rpc('spend_agent_credits', {
      p_user: user.id,
      p_amount: spent,
      p_model: model,
      p_usage: message.usage,
    });
    if (spendError) console.error('credit deduction failed', spendError); // still return the answer; it was paid for upstream

    return {
      message: {
        id: message.id,
        role: message.role,
        content: message.content,
        stop_reason: message.stop_reason,
      },
      credits: { spent, balance: spendError ? null : Number(newBalance) },
    };
  });
});