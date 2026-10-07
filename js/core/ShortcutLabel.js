import { formatComboLabel } from '../utils/FormatLabel.js';

const MOD_RE = /([⌃⌥⇧⌘])/;

export class ShortcutLabel {
  constructor(editor) {
    this.config = editor.config;
    this.signals = editor.signals;

    this.signals.shortcutsChanged.add(() => this.sync());
    this.sync();
  }

  sync() {
    const shortcuts = this.config.get('shortcuts') ?? {};

    document.querySelectorAll('[data-shortcut-key], [data-shortcut-combo]').forEach(el => {
      const combo = el.dataset.shortcutCombo ?? shortcuts[el.dataset.shortcutKey];
      if (combo === undefined) return;

      const format = el.dataset.shortcutFormat ?? 'upper';
      const repeat = parseInt(el.dataset.shortcutRepeat ?? '1');
      const label = Array(repeat).fill(formatComboLabel(combo, format)).join(' ');

      if (el.tagName === 'SPAN') {
        this.render(el, label);
      } else {
        el.dataset.shortcut = label;
      }
    });
  }

  render(el, label) {
    const nodes = label.split(MOD_RE).filter(Boolean).map(part => {
      if (!MOD_RE.test(part)) return document.createTextNode(part);
      const span = document.createElement('span');
      span.className = 'mod';
      span.textContent = part;
      return span;
    });
    el.replaceChildren(...nodes);
  }
}