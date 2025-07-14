const DB_NAME = 'kokraf-storage';
const DB_VERSION = 1;
const STORE_NAME = 'storage';
const PREFIX = 'kokraf:';

export class Storage {
  static async _getDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  static async get(key, defaultValue = null) {
    const db = await this._getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(PREFIX + key);

      request.onsuccess = () => {
        const result = request.result;
        if (result === undefined) {
          resolve(defaultValue);
        } else {
          resolve(result);
        }
      };

      request.onerror = () => {
        console.warn(`Storage.get("${key}") failed, returning default.`, request.error);
        resolve(defaultValue);
      };
    });
  }

  static async set(key, value) {
    const db = await this._getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(value, PREFIX + key);

      request.onsuccess = () => resolve();
      request.onerror = () => {
        console.error(`Storage.set("${key}") failed.`, request.error);
        reject(request.error);
      };
    });
  }

  static async remove(key) {
    const db = await this._getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(PREFIX + key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  static async clearAll() {
    const db = await this._getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAllKeys();

      request.onsuccess = () => {
        const keys = request.result;
        keys
          .filter(k => typeof k === 'string' && k.startsWith(PREFIX))
          .forEach(k => store.delete(k));
        resolve();
      };

      request.onerror = () => reject(request.error);
    });
  }
}