const DEFAULT_PORT = 7331;
const MIN_RETRY = 1000;
const MAX_RETRY = 15000;

export class AgentBridge {
  constructor(editor, registry, options = {}) {
    this.editor = editor;
    this.registry = registry;

    this.port = options.port ?? DEFAULT_PORT;
    this.token = options.token ?? localStorage.getItem('kokraf.agentToken') ?? null;
    this.url = options.url ?? `ws://127.0.0.1:${this.port}`;
    this.showBadge = options.showBadge ?? true;

    this.socket = null;
    this.status = 'idle';
    this.retryDelay = MIN_RETRY;
    this.retryTimer = null;
    this.stopped = false;
    this.loggedFailure = false;

    this._queue = Promise.resolve();

    this._badge = null;
  }

  static shouldAutoStart() {
    const flag = localStorage.getItem('kokraf.agent');
    if (flag === 'on') return true;
    if (flag === 'off') return false;
    return ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  }

  start() {
    this.stopped = false;
    this._connect();
    return this;
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    this.socket?.close(1000, 'stopped by user');
    this.socket = null;
    this._setStatus('idle');
  }

  _connect() {
    if (this.stopped) return;

    const url = this.token ? `${this.url}?token=${encodeURIComponent(this.token)}` : this.url;
    this._setStatus('connecting');

    let socket;
    try {
      socket = new WebSocket(url);
    } catch {
      this._scheduleReconnect();
      return;
    }

    this.socket = socket;

    socket.onopen = () => {
      this.retryDelay = MIN_RETRY;
      this.loggedFailure = false;
      this._setStatus('connected');
      console.info('[kokraf] agent bridge connected');
    };

    socket.onmessage = (event) => this._onMessage(event.data);

    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this._setStatus('disconnected');
      if (event.code !== 1000) this._scheduleReconnect();
    };

    socket.onerror = () => {
      if (!this.loggedFailure) {
        this.loggedFailure = true;
        console.info(`[kokraf] agent bridge not reachable at ${this.url} — retrying in the background`);
      }
    };
  }

  _scheduleReconnect() {
    if (this.stopped) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this._connect(), this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 2, MAX_RETRY);
  }

  _onMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    const { id, method, params } = message;
    if (id === undefined || !method) return;

    this._queue = this._queue.then(() => this._run(id, method, params ?? {}));
  }

  async _run(id, method, params) {
    try {
      const result = await this._dispatch(method, params);
      this._send({ id, result: this._sanitize(result) });
    } catch (err) {
      console.warn(`[kokraf] agent command "${method}" failed:`, err);
      this._send({ id, error: { message: err?.message ?? String(err), stack: err?.stack } });
    }
  }

  _dispatch(method, params) {
    if (method === 'system.ping') {
      return { ok: true, t: Date.now() };
    }

    if (method === 'system.describe') {
      return {
        app: 'kokraf',
        url: location.href,
        projectId: this.editor.currentProjectId ?? null,
        projectName: this.editor.currentProjectName ?? null,
        commands: this.registry.list(),
      };
    }

    return this.registry.execute(method, params);
  }

  _sanitize(result) {
    try {
      return JSON.parse(JSON.stringify(result ?? null));
    } catch (err) {
      throw new Error(`Command result is not serializable: ${err.message}`);
    }
  }

  _send(payload) {
    if (this.socket?.readyState !== 1) return;
    this.socket.send(JSON.stringify(payload));
  }

  notify(event, data) {
    this._send({ event, data });
  }

  _setStatus(status) {
    this.status = status;
    if (this.showBadge) this._renderBadge();
  }

  _renderBadge() {
    const colors = {
      idle: '#666',
      connecting: '#c08a00',
      connected: '#2e9e4f',
      disconnected: '#a33',
    };

    if (!this._badge) {
      const host = document.getElementById('floating-container') ?? document.body;
      this._badge = document.createElement('div');
      this._badge.id = 'agent-status-badge';
      this._badge.style.cssText = [
        'position:absolute',
        'bottom:8px',
        'left:8px',
        'z-index:50',
        'padding:3px 8px',
        'border-radius:10px',
        'font:11px/1.4 system-ui,sans-serif',
        'color:#fff',
        'pointer-events:none',
        'opacity:0.85',
      ].join(';');
      host.appendChild(this._badge);
    }

    this._badge.textContent = `agent: ${this.status}`;
    this._badge.style.background = colors[this.status] ?? '#666';
    this._badge.style.display = this.status === 'idle' ? 'none' : 'block';
  }
}