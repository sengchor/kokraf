import { supabase } from '/supabase/supabase.js';
import { buildTools, toToolResult } from './AgentTools.js';

export const AGENT_MODELS = [
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5'},
  { id: 'claude-opus-5-5', label: 'Opus 5.5'},
];
export const DEFAULT_MODEL = 'claude-sonnet-5-5';

const CONTINUE_SENTINEL = '<continue/>';

const CUT_OFF_RESULT =
  'This call was cut off at the length limit before its input was complete, so it was not run. ' +
  'Send it again, split into smaller calls if the input is large.';

function withoutTrailingThinking(content) {
  let end = content.length;
  while (end > 0 && (content[end - 1].type === 'thinking' || content[end - 1].type === 'redacted_thinking')) end--;
  return content.slice(0, end);
}

export async function invokeAgent(body) {
  const { data, error } = await supabase.functions.invoke('ai-agent', { body });

  if (!error) {
    if (data?.error) {
      const err = new Error(data.error);
      err.code = data.reason ?? 'upstream_error';
      throw err;
    }
    return data;
  }

  const detail = await error.context?.json?.().catch(() => null);
  const err = new Error(detail?.error ?? 'Could not reach the agent. Check your connection and try again.');
  err.code = detail?.reason ?? 'network';
  throw err;
}

export class AgentSession {
  constructor({ registry, model = DEFAULT_MODEL, invoke = invokeAgent, onEvent = () => {} }) {
    this.registry = registry;
    this.model = model;
    this.invoke = invoke;
    this.onEvent = onEvent;

    this.messages = [];
    this.toolset = null;
    this.running = false;
    this.stopRequested = false;
    this.generation = 0;
  }

  reset() {
    if (this.running) this.stopRequested = true;
    this.generation++;
    this.messages = [];
    this.toolset = null;
  }

  stop() {
    if (this.running) this.stopRequested = true;
  }

  async send(text) {
    if (this.running || !text.trim()) return;

    this._appendUser([{ type: 'text', text }]);
    const startGen = this.generation;
    const model = this.model;
    this.running = true;
    this.stopRequested = false;
    this.onEvent({ type: 'state', running: true });

    try {
      await this._runAgentLoop(startGen, model);
    } catch (err) {
      if (this.generation === startGen) this.onEvent({ type: 'error', message: err.message, code: err.code });
    } finally {
      this.running = false;
      this.stopRequested = false;
      this.onEvent({ type: 'state', running: false });
    }
  }

  async _runAgentLoop(gen, model) {
    this.toolset ??= buildTools(this.registry);
    const { tools, commandFor } = this.toolset;

    // The edge function enforces the step limit and answers 'step_limit'.
    for (;;) {
      const { message, credits } = await this.invoke({ model, messages: this.messages, tools });
      if (gen !== this.generation) return;

      if (credits) this.onEvent({ type: 'credits', ...credits });

      const cutOff = message.stop_reason === 'max_tokens';
      const content = cutOff ? withoutTrailingThinking(message.content) : message.content;

      // Everything else goes back exactly as returned, thinking blocks included.
      if (content.length > 0) {
        this.messages.push({ role: 'assistant', content });
        this.onEvent({ type: 'assistant', content });
      }

      const calls = content.filter((block) => block.type === 'tool_use');

      if (calls.length === 0) {
        // Finished, or cut off mid-text. Keep going after a cut-off unless the
        // user pressed Stop.
        if (!cutOff || this.stopRequested) return;
        this._appendUser([{ type: 'text', text: CONTINUE_SENTINEL }]);
        continue;
      }

      // After a cut-off, only the final block can be incomplete. Earlier tool
      // calls are whole and get run as normal.
      const last = content.at(-1);
      const partial = cutOff && last?.type === 'tool_use' ? last : null;

      // Every tool_use must get a tool_result, even when we don't run it,
      // or the next request is rejected.
      const results = [];
      for (const call of calls) {
        if (this.stopRequested) {
          results.push(toToolResult(call.id, 'Stopped by the user.', true));
        } else if (call === partial) {
          results.push(toToolResult(call.id, CUT_OFF_RESULT, true));
        } else {
          results.push(await this._runTool(call, commandFor));
        }
      }
      if (gen !== this.generation) return;

      this._appendUser(results);

      if (this.stopRequested) {
        this.onEvent({ type: 'notice', message: 'Stopped.' });
        return;
      }
    }
  }

  async _runTool(call, commandFor) {
    const command = commandFor(call.name);

    if (!command) {
      this.onEvent({ type: 'tool_result', id: call.id, ok: false, result: `Unknown tool ${call.name}` });
      return toToolResult(call.id, `Unknown tool "${call.name}".`, true);
    }

    try {
      const raw = await this.registry.execute(command, call.input ?? {});
      const result = JSON.parse(JSON.stringify(raw ?? null));
      this.onEvent({ type: 'tool_result', id: call.id, ok: true, result });
      return toToolResult(call.id, result);
    } catch (err) {
      const text = err?.message ?? String(err);
      console.warn(`[kokraf] agent command "${command}" failed:`, err);
      this.onEvent({ type: 'tool_result', id: call.id, ok: false, result: text });
      return toToolResult(call.id, text, true);
    }
  }

  // Consecutive user turns (tool results, then a new message after Stop or
  // an error) are merged so roles keep alternating.
  _appendUser(blocks) {
    const last = this.messages.at(-1);
    if (last?.role === 'user') {
      last.content = [...last.content, ...blocks];
    } else {
      this.messages.push({ role: 'user', content: blocks });
    }
  }

  async fetchCredits() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;

    const { data, error } = await supabase
      .from('profiles')
      .select('credits')
      .eq('id', session.user.id)
      .single();

    if (error) throw error;
    this.onEvent({ type: 'credits', balance: data.credits });
  }
}