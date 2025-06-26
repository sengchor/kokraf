import { Storage } from '../core/Storage.js';

export default class Config {
  constructor() {
    this.name = 'Kokraf';

    const saved = Storage.get('projectSettings', {
      antialias: true,
      shadows: true,
      shadowType: 1, // PCF
      tonemapping: 0, // NoToneMapping
      shortcuts: {
        translate: 'w',
        rotate: 'e',
        scale: 'r',
        undo: 'z',
        focus: 'f'
      },
      history: false,
    });

    this.storage = { ...saved };
  }

  set(key, value) {
    this.storage[key] = value;
    Storage.set('projectSettings', this.storage);
  }

  get(key) {
    return this.storage[key];
  }

  reset() {
    this.storage = { ...this.defaults };
  }

  save() {
    Storage.set('projectSettings', this.storage);
  }
}