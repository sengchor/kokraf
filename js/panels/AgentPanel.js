import { AgentSession, AGENT_MODELS, DEFAULT_MODEL } from '../agent/hosted/AgentSession.js';
import { toolNameFor } from '../agent/hosted/AgentTools.js';

const EMPTY_HINT = 'Ask the agent to do something, like "Model a chair."';
const RESULT_LIMIT = 4000;
const STICK_THRESHOLD = 40;
const CREDITS_TIL = 15000;

const MODEL_STORAGE_KEY = 'kokraf.agent.model';

function loadModel() {
  try {
    const id = localStorage.getItem(MODEL_STORAGE_KEY);
    return AGENT_MODELS.some((m) => m.id === id) ? id : DEFAULT_MODEL;
  } catch {
    return DEFAULT_MODEL;
  }
}

function saveModel(id) {
  try { localStorage.setItem(MODEL_STORAGE_KEY, id); } catch {}
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class AgentPanel {
  constructor({ registry, signals, container, tab }) {
    if (!container) throw new Error('AgentPanel: missing container');
    if (!tab) throw new Error('AgentPanel: missing tab button');

    this.registry = registry;
    this.signals = signals;
    this.container = container;
    this.tab = tab;
    this.toolRows = new Map();
    this.stickToBottom = true;
    this.creditsFetchedAt = 0;

    this.session = new AgentSession({
      registry,
      model: loadModel(),
      onEvent: (event) => this._onEvent(event),
    });

    this.root = this._build();
    this.container.appendChild(this.root);

    this.tab.hidden = true;

    this.tab.addEventListener('click', () => this._onShown());
  }

  get isOpen() {
    return !this.tab.hidden;
  }

  get isActive() {
    return this.container.style.display !== 'none';
  }

  open() {
    this.tab.hidden = false;

    if (this.isActive) {
      this._onShown();
    } else {
      this.tab.click();
    }
  }

  close() {
    if (this.isActive) {
      const firstTab = this.tab.parentElement?.querySelector('.tab:not([hidden])');
      if (firstTab && firstTab !== this.tab) firstTab.click();
    }

    this.tab.hidden = true;
  }

  toggle() {
    this.isOpen ? this.close() : this.open();
    return this.isOpen;
  }

  newChat() {
    this.session.reset();
    this.toolRows.clear();
    this.stickToBottom = true;
    this.log.replaceChildren(this.empty);
    this.input.focus();
  }

  /* ---------------------------------------------------------------- */

  _build() {
    const root = el('section', 'agent-panel');
    root.setAttribute('aria-label', 'Agent');

    for (const type of ['keydown', 'keyup', 'keypress']) {
      root.addEventListener(type, (e) => e.stopPropagation());
    }

    const toolbar = el('div', 'agent-panel__toolbar');
    this.balance = el('span', 'agent-panel__balance');
    const newChat = el('button', 'agent-panel__button', 'NEW CHAT');
    newChat.type = 'button';
    newChat.onclick = () => this.newChat();
    toolbar.append(this.balance, newChat);

    this.log = el('div', 'agent-panel__log');
    this.log.setAttribute('role', 'log');
    this.log.setAttribute('aria-live', 'polite');
    this.log.addEventListener('scroll', () => {
      this.stickToBottom = this._isNearBottom();
    });
    this.empty = el('p', 'agent-panel__empty', EMPTY_HINT);
    this.log.append(this.empty);

    const composer = el('div', 'agent-panel__composer');
    this.input = el('textarea', 'agent-panel__input');
    this.input.rows = 3;
    this.input.placeholder = 'Ask the agent';
    this.input.setAttribute('aria-label', 'Message to the agent');
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        this._submit();
      }
    });

    const footer = el('div', 'agent-panel__composer-footer');

    this.modelSelect = el('select', 'agent-panel__model');
    this.modelSelect.setAttribute('aria-label', 'Model');
    for (const { id, label } of AGENT_MODELS) {
      const option = el('option', null, label);
      option.value = id;
      this.modelSelect.append(option);
    }
    this.modelSelect.value = this.session.model;
    this.modelSelect.addEventListener('change', () => {
      this.session.model = this.modelSelect.value;
      saveModel(this.modelSelect.value);
      this.input.focus();
    });

    this.sendButton = el('button', 'agent-panel__send', 'SEND');
    this.sendButton.type = 'button';
    this.sendButton.onclick = () => this._submit();

    footer.append(this.modelSelect, this.sendButton);
    composer.append(this.input, footer);

    root.append(toolbar, this.log, composer);
    return root;
  }

  _onShown() {
    requestAnimationFrame(() => {
      if (this.stickToBottom) this.log.scrollTop = this.log.scrollHeight;
      this.input.focus();
    });
    this._refreshCredits();
  }

  _submit(text = this.input.value) {
    if (this.session.running) {
      this.session.stop();
      this.sendButton.textContent = 'STOPPING';
      this.sendButton.disabled = true;
      return;
    }

    text = text.trim();
    if (!text) return;

    this.input.value = '';
    this.stickToBottom = true;
    this._append(el('div', 'agent-msg agent-msg--user', text));
    this.session.send(text);
  }

  _onEvent(event) {
    switch (event.type) {
      case 'state':
        this.sendButton.textContent = event.running ? 'STOP' : 'SEND';
        this.sendButton.disabled = false;
        this.root.classList.toggle('is-running', event.running);
        this.tab.classList.toggle('agent-tab--running', event.running);
        break;

      case 'assistant':
        for (const block of event.content) {
          if (block.type === 'text' && block.text.trim()) {
            this._append(el('div', 'agent-msg agent-msg--assistant', block.text));
          } else if (block.type === 'tool_use') {
            this._appendToolRow(block);
          }
        }
        break;

      case 'tool_result':
        this._finishToolRow(event.id, event.ok, event.result);
        break;

      case 'credits':
        if (event.balance !== null && event.balance !== undefined) {
          this.balance.textContent = `${event.balance} credits`;
        }
        break;

      case 'notice':
        this._append(el('div', 'agent-note', event.message));
        break;

      case 'error':
        if (event.code === 'step_limit') this._appendStepLimit(event.message);
        else this._appendError(event);
        break;
    }
  }

  _appendToolRow(call) {
    const row = el('details', 'agent-tool is-pending');
    const summary = el('summary', 'agent-tool__summary');
    summary.append(
      el('span', 'agent-tool__status'),
      el('code', 'agent-tool__name', this._commandName(call.name)),
    );
    const input = el('pre', 'agent-tool__body', JSON.stringify(call.input ?? {}, null, 2));
    row.append(summary, input);
    this.toolRows.set(call.id, row);
    this._append(row);
  }

  _finishToolRow(id, ok, result) {
    const row = this.toolRows.get(id);
    if (!row) return;
    row.classList.remove('is-pending');
    row.classList.add(ok ? 'is-ok' : 'is-error');

    const isImage = result && typeof result === 'object' && result.__image;
    const text = isImage
      ? 'Viewport image'
      : typeof result === 'string'
        ? result
        : JSON.stringify(result, null, 2);
    const clipped = text.length > RESULT_LIMIT ? `${text.slice(0, RESULT_LIMIT)}\n…` : text;
    row.append(el('pre', 'agent-tool__body agent-tool__result', clipped));
    if (!ok) row.open = true;
  }

  // A pause, not a failure: shown as a note with a one-click way to go on.
  _appendStepLimit(message) {
    const note = el('div', 'agent-note');
    note.append(el('p', null, message));
    const resume = el('button', 'agent-panel__button agent-error__action', 'CONTINUE');
    resume.type = 'button';
    resume.onclick = () => {
      resume.disabled = true;
      this._submit('continue');
    };
    note.append(resume);
    this._append(note);
  }

  _appendError({ message, code }) {
    const box = el('div', 'agent-error');
    box.append(el('p', null, message));

    const action = (label, onClick) => {
      const button = el('button', 'agent-panel__button agent-error__action', label);
      button.type = 'button';
      button.onclick = onClick;
      box.append(button);
    };

    if (code === 'no_credits') {
      action('BUY CREDITS', () => this.signals.showAccountPanel.dispatch());
    } else if (code === 'unauthenticated') {
      action('SIGN IN', () => this.signals.showLoginPanel.dispatch());
    } else if (code === 'too_large' || code === 'invalid_conversation') {
      action('START A NEW CHAT', () => this.newChat());
    }

    this._append(box);
  }

  _commandName(toolName) {
    const match = this.registry.list().find((c) => toolNameFor(c.name) === toolName);
    return match?.name ?? toolName;
  }

  _isNearBottom() {
    return this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < STICK_THRESHOLD;
  }

  _append(node) {
    this.empty.remove();
    this.log.append(node);
    if (this.stickToBottom) this.log.scrollTop = this.log.scrollHeight;
  }

  async _refreshCredits() {
    if (this.session.running) return;
    if (Date.now() - this.creditsFetchedAt < CREDITS_TIL) return;

    this.creditsFetchedAtAt = Date.now();
    try {
      await this.session.fetchCredits();
    } catch {
      this.creditsFetchedAt = 0;
    }
  }
}