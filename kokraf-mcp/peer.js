import { WebSocketServer, WebSocket } from 'ws';

export const isAddrInUse = (err) =>
  err?.code === 'EADDRINUSE' || /already in use/i.test(err?.message ?? '');

const send = (ws, payload) => {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
};

/**
 * Runs in the instance that owns the editor port (the "leader"). Other
 * kokraf-mcp instances, i.e. other Claude sessions, connect here and have
 * their calls forwarded to the editor through the leader's bridge.
 */
export class PeerHub {
  constructor({ port, token = null, call, log }) {
    this.port = port;
    this.token = token;
    this.call = call;
    this.log = log;
    this.wss = null;
    this.clients = new Set();
  }

  start() {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({
        host: '127.0.0.1',
        port: this.port,
        verifyClient: ({ origin, req }, done) => {
          // Browsers always send Origin; Node peers don't. A web page must
          // never be able to drive the editor through this port.
          if (origin) return done(false, 403, 'peers only');
          if (this.token) {
            const url = new URL(req.url, 'http://127.0.0.1');
            if (url.searchParams.get('token') !== this.token) return done(false, 401, 'bad token');
          }
          done(true);
        },
      });

      const onStartError = (err) => {
        wss.close();
        reject(err);
      };

      wss.once('error', onStartError);
      wss.once('listening', () => {
        wss.off('error', onStartError);
        wss.on('error', (err) => this.log(`peer hub error: ${err.message}`));
        this.wss = wss;
        resolve();
      });
      wss.on('connection', (ws) => this._onPeer(ws));
    });
  }

  _onPeer(ws) {
    this.clients.add(ws);
    this.log(`peer session connected (${this.clients.size} total)`);

    ws.on('close', () => this.clients.delete(ws));
    ws.on('error', () => {});
    ws.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }

      const { id, method, params, timeout } = msg;
      if (id === undefined || !method) return;

      try {
        const result = await this.call(method, params ?? {}, timeout);
        send(ws, { id, result });
      } catch (err) {
        send(ws, { id, error: { message: err?.message ?? String(err) } });
      }
    });
  }

  broadcast(event, data) {
    for (const ws of this.clients) send(ws, { event, data });
  }

  async stop() {
    for (const ws of this.clients) ws.terminate();
    this.clients.clear();
    if (this.wss) await new Promise((resolve) => this.wss.close(() => resolve()));
    this.wss = null;
  }
}

/**
 * Runs in every instance that lost the race for the editor port (a
 * "follower"). Forwards calls to the leader's PeerHub.
 */
export class PeerClient {
  constructor({ port, token = null, log }) {
    this.port = port;
    this.token = token;
    this.log = log;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.onEvent = () => {};
    this.onClose = () => {};
  }

  get open() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect() {
    const base = `ws://127.0.0.1:${this.port}`;
    const url = this.token ? `${base}?token=${encodeURIComponent(this.token)}` : base;

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);

      // Persistent listener: rejects before open, is a no-op after, and keeps
      // a later socket error from crashing the process.
      ws.on('error', reject);
      ws.once('open', () => {
        this.ws = ws;
        resolve();
      });
      ws.on('message', (raw) => this._onMessage(raw));
      ws.on('close', () => {
        const wasOpen = this.ws === ws;
        this.ws = null;

        const lost = new Error('Lost connection to the kokraf-mcp session that owns the editor.');
        for (const entry of this.pending.values()) entry.reject(lost);
        this.pending.clear();

        if (wasOpen) this.onClose();
      });
    });
  }

  call(method, params, timeout) {
    if (!this.open) {
      return Promise.reject(new Error('Not connected to the kokraf-mcp session that owns the editor.'));
    }

    const id = this.nextId++;

    return new Promise((resolve, reject) => {
      // A little slack so the leader's own timeout error arrives first.
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`"${method}" timed out after ${timeout} ms (via peer)`));
      }, timeout + 2000);

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });

      this.ws.send(JSON.stringify({ id, method, params, timeout }));
    });
  }

  _onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.event) {
      this.onEvent(msg.event, msg.data);
      return;
    }

    const entry = this.pending.get(msg.id);
    if (!entry) return;
    this.pending.delete(msg.id);

    if (msg.error) entry.reject(new Error(msg.error.message));
    else entry.resolve(msg.result);
  }

  close() {
    this.ws?.close();
  }
}