import { EventEmitter } from 'node:events';
import { WebSocketServer } from 'ws';

export const DEFAULT_ORIGINS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https?:\/\/\[::1\](:\d+)?$/,
  /^https:\/\/kokraf\.com$/,
  /^https:\/\/[a-z0-9-]+\.github\.io$/,
];

export class EditorBridge extends EventEmitter {
  constructor({
    port = 7331,
    host = '127.0.0.1',
    token = null,
    allowedOrigins = DEFAULT_ORIGINS,
    log = () => {},
  } = {}) {
    super();
    this.port = port;
    this.host = host;
    this.token = token;
    this.allowedOrigins = allowedOrigins;
    this.log = log;

    this.wss = null;
    this.socket = null;
    this.editorInfo = null;
    this.pending = new Map();
    this._nextId = 1;
  }

  get connected() {
    return this.socket?.readyState === 1;
  }

  start() {
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ port: this.port, host: this.host });

      this.wss.on('listening', () => {
        this.log(`bridge listening on ws://${this.host}:${this.port}`);
        resolve(this);
      });

      this.wss.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`Port ${this.port} is already in use — another bridge is probably running.`));
        } else {
          reject(err);
        }
      });

      this.wss.on('connection', (socket, req) => this._onConnection(socket, req));
    });
  }

  async stop() {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(new Error('Bridge shutting down.'));
    }
    this.pending.clear();
    this.socket?.close(1001, 'server shutting down');
    await new Promise((resolve) => (this.wss ? this.wss.close(resolve) : resolve()));
  }

  _onConnection(socket, req) {
    const origin = req.headers.origin;
    const url = new URL(req.url, 'http://localhost');

    // No Origin header means a non-browser client (poke.js, a test script).
    if (origin && !this.allowedOrigins.some((rx) => rx.test(origin))) {
      this.log(`rejected connection from origin ${origin}`);
      socket.close(1008, 'origin not allowed');
      return;
    }

    if (this.token && url.searchParams.get('token') !== this.token) {
      this.log('rejected connection with bad token');
      socket.close(1008, 'bad token');
      return;
    }

    // One editor at a time. Newest wins — a stale tab left open is the common case.
    if (this.socket && this.socket.readyState === 1) {
      this.log('replacing previous editor connection');
      this.socket.close(4000, 'replaced by a newer connection');
    }

    this.socket = socket;
    this.editorInfo = null;
    this.log(`editor connected${origin ? ` (${origin})` : ''}`);

    socket.on('message', (raw) => this._onMessage(raw));

    socket.on('close', () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.editorInfo = null;
      this.log('editor disconnected');
      this.emit('editor:disconnected');
    });

    socket.on('error', (err) => this.log(`socket error: ${err.message}`));

    this.emit('editor:connected', this);
  }

  _onMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      this.log('dropped unparseable frame from editor');
      return;
    }

    if (message.event) {
      this.emit(`editor:${message.event}`, message.data);
      return;
    }

    const entry = this.pending.get(message.id);
    if (!entry) return;

    clearTimeout(entry.timer);
    this.pending.delete(message.id);

    if (message.error) {
      const err = new Error(message.error.message ?? 'Editor returned an error.');
      err.editorStack = message.error.stack;
      entry.reject(err);
    } else {
      entry.resolve(message.result);
    }
  }

  call(method, params = {}, timeoutMs = 20000) {
    if (!this.connected) {
      return Promise.reject(
        new Error('The Kokraf editor is not connected. Open the editor tab and make sure the agent bridge is enabled.')
      );
    }

    const id = this._nextId++;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Editor did not respond to "${method}" within ${timeoutMs}ms.`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  waitForEditor(timeoutMs = 0) {
    if (this.connected) return Promise.resolve(this);

    return new Promise((resolve, reject) => {
      const timer = timeoutMs
        ? setTimeout(() => {
            this.off('editor:connected', onConnect);
            reject(new Error(`No editor connected within ${timeoutMs}ms.`));
          }, timeoutMs)
        : null;

      const onConnect = () => {
        if (timer) clearTimeout(timer);
        resolve(this);
      };

      this.once('editor:connected', onConnect);
    });
  }
}