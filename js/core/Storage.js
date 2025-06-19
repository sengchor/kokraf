const PREFIX = 'kokraf:';

export class Storage {
  static get(key, defaultValue = null) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      if (raw === null) return defaultValue;
      return JSON.parse(raw);
    } catch (e) {
      console.warn(`Storage.get("${key}") parse failed, returning default.`, e);
      return defaultValue;
    }
  }

  static set(key, value) {
    try {
      const raw = JSON.stringify(value);
      localStorage.setItem(PREFIX + key, raw);
    } catch (e) {
      console.error(`Storage.set("${key}") failed.`, e);
    }
  }

  static remove(key) {
    localStorage.removeItem(PREFIX + key);
  }

  static clearAll() {
    Object.keys(localStorage)
      .filter(k => k.startsWith(PREFIX))
      .forEach(k => localStorage.removeItem(k));
  }
}
