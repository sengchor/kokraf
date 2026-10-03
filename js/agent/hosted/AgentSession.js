import { supabase } from '/supabase/supabase.js';
import { buildTools, toToolResult } from './AgentTools.js';

export async function invokeAgent(body) {
  const { data, error } = await supabase.functions.invoke('ai-agent', { body });
  if (!error) return data;

  const detail = await error.context?.json?.().catch(() => null);
  const err = new Error(detail?.error ?? 'Could not reach the agent. Check your connection and try again.');
  err.code = detail?.reason ?? 'network';
  throw err;
}

export class AgentSession {
  constructor({ registry, invoke = invokeAgent, onEvent = () => {} }) {
    this.registry = registry;
    this.invoke = invoke;
    this.onEvent = onEvent;

    this.messages = [];
    this.running = false;
    this.stopRequested = false;
    this.generation = 0;
  }

  reset() {
    if (this.running) this.stopRequested = true;
    this.generation++;
    this.messages = [];
  }

  stop() {
    if (this.running) this.stopRequested = true;
  }

  async send(text) {
    if (this.running || !text.trim()) return;

    this._appendUser([{ type: 'text', text }]);
    const startGen = this.generation;
    this.running = true;
    this.stopRequested = false;
    this.onEvent({ type: 'state', running: true });

    try {
      await this._runAgentLoop(startGen);
    } catch (err) {
      if (this.generation === startGen) this.onEvent({ type: 'error', message: err.message, code: err.code });
    } finally {
      this.running = false;
      this.stopRequested = false;
      this.onEvent({ type: 'state', running: false });
    }
  }

  async _runAgentLoop(gen) {
    // Rebuilt per message: commands can change between messages.
    const { tools, commandFor } = buildTools(this.registry);

    // The edge function enforces the step limit and answers 'step_limit'.
    for (;;) {
      const { message, credits } = await this.invoke({ messages: this.messages, tools });
      if (gen !== this.generation) return;

      this.messages.push({ role: 'assistant', content: message.content });
      this.onEvent({ type: 'assistant', content: message.content });
      if (credits) this.onEvent({ type: 'credits', ...credits });

      const calls = message.content.filter((block) => block.type === 'tool_use');
      if (calls.length === 0) return;

      // Every tool_use must get a tool_result, even when we don't run it,
      // or the next request is rejected.
      const cutOff = message.stop_reason !== 'tool_use';
      const results = [];

      for (const call of calls) {
        if (cutOff || this.stopRequested) {
          const reason = cutOff ? 'The response was cut off before this call finished.' : 'Stopped by the user.';
          results.push(toToolResult(call.id, reason, true));
          continue;
        }
        results.push(await this._runTool(call, commandFor));
      }
      if (gen !== this.generation) return;

      this._appendUser(results);

      if (this.stopRequested) {
        this.onEvent({ type: 'notice', message: 'Stopped.' });
        return;
      }
      if (cutOff) {
        this.onEvent({ type: 'notice', message: 'The reply was too long and got cut off. Ask Claude to continue.' });
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