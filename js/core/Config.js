import { Storage } from '../core/Storage.js';

export default class Config {
  constructor() {
    this.name = 'Kokraf';

    this.defaults = {
      antialias: true,
      shadows: true,
      shadowType: 1, // PCF
      tonemapping: 0, // NoToneMapping
      shortcuts: {
        select: 'w',
        translate: 'g',
        rotate: 'r',
        scale: 's',
        extrude: 'e',
        loopcut: 'ctrl+r',
        knife: 'k',
        inset: 'i',
        bevel: 'ctrl+b',

        undo: 'ctrl+z',
        redo: 'ctrl+shift+z',
        focusOrigin: 'shift+c', 
        focusSelected: 'shift+f',
        duplicate: 'shift+d',
        
        join: 'ctrl+j',
        selectAll: 'a',
        selectLinked: 'l',
        createFace: 'f',
        seperate: 'p',
        merge: 'm',
        split: 'y',
      },
      history: false,
    };

    this.storage = {};
    this.loadSettings();
  }

  async loadSettings() {
    const saved = await Storage.get('projectSettings', this.defaults);

    if (!saved || this.isStale(saved)) {
      this.storage = { ...this.defaults };
      await Storage.set('projectSettings', this.storage);
      return;
    }

    this.storage = { ...this.defaults, ...saved };
  }

  async set(key, value) {
    this.storage[key] = value;
    await Storage.set('projectSettings', this.storage);
  }

  get(key) {
    return this.storage[key];
  }

  reset() {
    this.storage = { ...this.defaults };
    this.save();
  }

  async save() {
    await Storage.set('projectSettings', this.storage);
  }

  isStale(saved) {
    return this.hasStructureMismatch(this.defaults, saved);
  }

  hasStructureMismatch(defaults, saved) {
    if (typeof defaults !== typeof saved) return true;
    if (Array.isArray(defaults)) return !Array.isArray(saved);
    if (typeof defaults !== 'object' || defaults === null) return false;

    const defaultKeys = Object.keys(defaults).sort();
    const savedKeys = Object.keys(saved ?? {}).sort();

    if (defaultKeys.length !== savedKeys.length) return true;
    if (defaultKeys.some((k, i) => k !== savedKeys[i])) return true;

    return defaultKeys.some(k => this.hasStructureMismatch(defaults[k], saved[k]));
  }
}