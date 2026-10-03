import "@supabase/functions-js/edge-runtime.d.ts";

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from "@supabase/supabase-js";

const MODELS: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 150, output: 750 },
  'claude-sonnet-5-5': { input: 300, output: 1500 },
  'claude-opus-5-5': { input: 600, output: 3000 },
};
const DEFAULT_MODEL = 'claude-sonnet-5-5';

const MIN_BALANCE = 1;
const MAX_TOKENS = 4096;
 
const MAX_STEPS = 25;
 
const MAX_TOOLS = 64;
const MAX_TOOL_DESCRIPTION_CHARS = 2000;
const MAX_TOOL_SCHEMA_CHARS = 8000;
const MAX_MESSAGES = 200;
const MAX_BODY_CHARS = 8_000_000;
const MAX_RESULT_CHARS = 100_000;
const MAX_IMAGES = 4;

 
const CACHE_WRITE_FACTOR = 1.25;
const CACHE_READ_FACTOR = 0.1;
 
const SYSTEM_PROMPT = `You are the modeling assistant inside Kokraf, a web-based 3D editor. You change the user's open scene by calling tools.
 
Coordinates: Kokraf is Z-up. +X is front, +Y is right, +Z is up. This is not the three.js Y-up convention, even though the editor is built on three.js. Every position, rotation, scale and pivot you send or receive is Z-up. "Move up by 1" is a translation of [0, 0, 1].
 
How to work:
- Look before you edit. Use scene_outline and mesh_inspect to find objects, element indices and current positions instead of guessing.
- Make one change at a time and check the result before the next one. Use viewport_capture when the visual result matters.
- Every edit is undoable. If a step goes wrong, undo it with editor_undo rather than stacking corrections on top.
- If a request is ambiguous in a way that changes the result (which object, how big, which side), ask a short question instead of guessing.
- When you finish, say in a sentence or two what you changed. Keep replies short; the user is looking at the viewport, not reading.`;
 
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
 
/** Claude calls since the user last typed something. */
function stepsSinceUserText(messages: any[]) {
  let steps = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === 'assistant') {
      steps++;
    } else if (typeof m?.content === 'string' || m?.content?.some?.((b: any) => b?.type === 'text')) {
      break;
    }
  }
  return steps;
}
 
const truncate = (text: string) =>
  text.length > MAX_RESULT_CHARS
    ? `${text.slice(0, MAX_RESULT_CHARS)}\n\n[truncated: narrow the request, e.g. with maxObjects or root]`
    : text;
 
/**
 * Caps tool results: long text is truncated, and only the newest MAX_IMAGES
 * viewport captures are kept. Deterministic for a given history, so the
 * prompt cache prefix stays stable between steps.
 */
function trimToolResults(messages: any[]) {
  const out = structuredClone(messages);
  let imagesKept = 0;
 
  for (let i = out.length - 1; i >= 0; i--) {
    const m = out[i];
    if (m?.role !== 'user' || !Array.isArray(m.content)) continue;
 
    for (const block of m.content) {
      if (block?.type !== 'tool_result') continue;
 
      if (typeof block.content === 'string') {
        block.content = truncate(block.content);
        continue;
      }
      if (!Array.isArray(block.content)) continue;
 
      block.content = block.content.map((part: any) => {
        if (part?.type === 'text' && typeof part.text === 'string') return { ...part, text: truncate(part.text) };
        if (part?.type === 'image') {
          if (imagesKept < MAX_IMAGES) {
            imagesKept++;
            return part;
          }
          return { type: 'text', text: '[earlier viewport capture removed to save space]' };
        }
        return part;
      });
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
 
function creditsFor(rate: { input: number; output: number }, usage: Anthropic.Usage) {
  const input =
    usage.input_tokens +
    (usage.cache_creation_input_tokens ?? 0) * CACHE_WRITE_FACTOR +
    (usage.cache_read_input_tokens ?? 0) * CACHE_READ_FACTOR;
  const credits = (input * rate.input + usage.output_tokens * rate.output) / 1_000_000;
  return Math.max(1, Math.ceil(credits));
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
  if (stepsSinceUserText(messages) >= MAX_STEPS) {
    return fail(409, `Paused after ${MAX_STEPS} steps. Send "continue" to keep going.`, 'step_limit');
  }
 
  // Can they pay for it.
  const { data: balance, error: balanceError } = await supabase.rpc('agent_credit_balance', { p_user: user.id });
  if (balanceError) {
    console.error('balance lookup failed', balanceError);
    return fail(500, 'Could not check your credit balance.', 'balance_error');
  }
  const minBalance = Math.max(MIN_BALANCE, Math.ceil((MAX_TOKENS * rate.output) / 1_000_000));
  if (Number(balance) < minBalance) {
    return fail(402, "You've reached your current credit limit.", 'no_credits', { balance: Number(balance) });
  }
 
  // Ask Claude.
  let message: Anthropic.Message;
  try {
    message = await anthropic.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      // One breakpoint here caches tools + system together, since tools come first.
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: tools as Anthropic.Tool[],
      messages: withCacheBreakpoint(trimToolResults(messages)),
    });
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      console.error('anthropic error', err.status, err.message);
      if (err.status === 400) return fail(400, err.message, 'invalid_conversation');
      if (err.status === 429 || err.status === 529) {
        return fail(503, 'Claude is busy right now. Try again in a moment.', 'busy');
      }
    } else {
      console.error('anthropic call failed', err);
    }
    return fail(502, 'Could not reach Claude. Try again.', 'upstream_error');
  }
 
  // Charge for what was actually used.
  const spent = creditsFor(rate, message.usage);
  const { data: newBalance, error: spendError } = await supabase.rpc('spend_agent_credits', {
    p_user: user.id,
    p_amount: spent,
    p_model: model,
    p_usage: message.usage,
  });
  if (spendError) console.error('credit deduction failed', spendError); // still return the answer; it was paid for upstream
 
  return json({
    message: {
      id: message.id,
      role: message.role,
      content: message.content,
      stop_reason: message.stop_reason,
    },
    credits: { spent, balance: spendError ? null : Number(newBalance) },
  });
});