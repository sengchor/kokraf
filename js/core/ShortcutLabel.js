import { formatComboLabel } from '../utils/FormatLabel.js';

export class ShortcutLabel{
  constructor(editor) {
    this.config = editor.config;
    this.signals = editor.signals;

    this.signals.shortcutsChanged.add(() => this.sync());
    this.sync();
  }

  sync() {
    const shortcuts = this.config.get('shortcuts');
    if (!shortcuts) return;

    document.querySelectorAll('[data-shortcut-key]').forEach(el => {
      const key = el.dataset.shortcutKey;
      const combo = shortcuts[key];
      if (combo === undefined) return;

      const format = el.dataset.shortcutFormat ?? 'upper';
      const repeat = parseInt(el.dataset.shortcutRepeat ?? '1');
      const label = Array(repeat).fill(formatComboLabel(combo, format)).join(' ');

      if (el.tagName === 'SPAN') {
        el.textContent = label;
      } else {
        el.dataset.shortcut = label;
      }
    });
  }
}