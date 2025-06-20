import * as THREE from 'three';

export class SidebarSetting {
  constructor(editor) {
    this.editor = editor;
    this.config = editor.config;

    this.init();
  }

  init() {
    this.initShortcuts();
  }

  initShortcuts() {
    const keys = ['translate', 'rotate', 'scale', 'undo', 'focus'];

    keys.forEach(key => {
      const input = document.getElementById(`${key}-shortcut`);
      if (!input) return;
      const shortcuts = this.config.get('shortcuts');
      input.value = shortcuts[key] || '';

      input.addEventListener('input', () => {
        const val = input.value.toLowerCase();
        input.value = val;

        shortcuts[key] = val;
        this.config.save();
      });
    });
  }
}