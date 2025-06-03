export class Signal {
  constructor() {
    this._listeners = [];
  }

  add(listener) {
    if (!this._listeners.includes(listener)) {
      this._listeners.push(listener);
    }
  }

  remove(listener) {
    const index = this._listeners.indexOf(listener);
    if (index !== -1) {
      this._listeners.splice(index, 1);
    }
  }

  dispatch(...args) {
    for (const listener of this._listeners) {
      listener(...args);
    }
  }

  dispose() {
    this._listeners.length = 0;
  }
}