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
        translate: 'g',
        rotate: 'r',
        scale: 's',
        undo: 'z',
        focus: 'f'
      },
      history: false,
    };

    this.storage = {};

    this.loadSettings();
  }

  async loadSettings() {
    const saved = await Storage.get('projectSettings', this.defaults);
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
}