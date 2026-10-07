import * as THREE from 'three';
import { formatKey, buildCombo, formatComboLabel } from '../utils/FormatLabel.js';

// Keys are canonical: "ctrl" means Cmd on Mac, Ctrl elsewhere
const RESERVED_KEYS = new Map([
  ['tab', 'Switch mode'],
  ['shift', 'Multi-select'],
  ['ctrl+c', 'Copy'],
  ['ctrl+v', 'Paste'],
  ['ctrl+s', 'Save'],
  ['delete', 'Delete'],
  ['shift+a', 'Add Context Menu'],
  ['ctrl+a', 'Apply Context Menu'],

  // Browser shortcuts that can't be overridden with preventDefault
  ['ctrl+w', 'Browser (close tab)'],
  ['ctrl+q', 'Browser (quit)'],
  ['ctrl+n', 'Browser (new window)'],
  ['ctrl+t', 'Browser (new tab)'],
  ['ctrl+shift+t', 'Browser (reopen tab)'],
  ['ctrl+shift+n', 'Browser (private window)'],
]);

export class SidebarSetting {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.config = editor.config;
    this.history = editor.history;

    this.clearButton = document.getElementById('clear-button');
    this.persistentButton = document.getElementById('persistent');
    this.historyList = document.getElementById('history-list');

    this.init();
  }

  init() {
    this.initShortcuts();
    this.initHistory();
  }

  initShortcuts() {
    const shortcuts = this.config.get('shortcuts');
    const list = document.getElementById('shortcuts-list');
    this.errorEl = document.getElementById('shortcut-error');
    this.errorMsg = this.errorEl?.querySelector('.shortcut-error-msg');

    const inputs = this.generateShortcutsList(shortcuts, list);
    this.initRestoreBtn(shortcuts, inputs);

    for (const key of Object.keys(shortcuts)) {
      const input = inputs[key];

      // Canonical values (e.g. "ctrl+z"); input.value only holds the display label
      let prevVal = shortcuts[key] ?? '';
      let pendingVal = null;

      input.addEventListener('focus', () => {
        this.clearShortcutError(input);
        input.dataset.capturing = 'true';
        input.value = '';
        input.placeholder = 'Press a key';
        input.classList.add('capturing');
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          input.blur();
          return;
        }
        if (e.key === 'Escape') {
          pendingVal = null;
          input.value = formatComboLabel(prevVal);
          this.clearShortcutError(input);
          input.blur();
          return;
        }
        if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

        e.preventDefault();

        const val = buildCombo(e);
        input.value = formatComboLabel(val);
        pendingVal = val;

        const conflict = this.getConflict(shortcuts, key, val);
        if (conflict) { this.showShortcutError(input, conflict); return; }
        this.clearShortcutError(input);
      });

      input.addEventListener('blur', () => {
        input.dataset.capturing = '';
        input.placeholder = '';
        input.classList.remove('capturing');

        if (input.classList.contains('conflict') || pendingVal === null) {
          input.value = formatComboLabel(prevVal);
          this.clearShortcutError(input);
          pendingVal = null;
          return;
        }

        prevVal = pendingVal;
        shortcuts[key] = pendingVal;
        input.value = formatComboLabel(pendingVal);
        pendingVal = null;
        this.config.save();
        this.signals.shortcutsChanged.dispatch();
        this.syncRestoreBtn();
      });

      // Keep prevVal in sync when defaults are restored
      input.addEventListener('shortcut-restored', () => {
        prevVal = shortcuts[key] ?? '';
      });
    }
  }

  initRestoreBtn(shortcuts, inputs) {
    const defaults = this.config.defaults.shortcuts;
    const restoreBtn = document.getElementById('restore-shortcuts-btn');

    const isModified = () => Object.keys(defaults).some(k => shortcuts[k] !== defaults[k]);
    this.syncRestoreBtn = () => {
      restoreBtn.style.display = isModified() ? '' : 'none';
    };

    this.syncRestoreBtn();

    restoreBtn.addEventListener('click', () => {
      Object.assign(shortcuts, defaults);
      for (const key of Object.keys(shortcuts)) {
        inputs[key].value = formatComboLabel(shortcuts[key]);
        inputs[key].dispatchEvent(new Event('shortcut-restored'));
      }
      this.clearShortcutError(null);
      this.config.save();
      this.signals.shortcutsChanged.dispatch();
      this.syncRestoreBtn();
    });
  }

  generateShortcutsList(shortcuts, list) {
    const inputs = {};

    for (const key of Object.keys(shortcuts)) {
      const li = document.createElement('li');
      li.className = 'setting-option';

      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = formatKey(key);

      const input = document.createElement('input');
      input.className = 'key-input';
      input.type = 'text';
      input.value = formatComboLabel(shortcuts[key] ?? '');
      input.id = `${key}-shortcut`;
      input.readOnly = true;

      li.appendChild(label);
      li.appendChild(input);
      list.appendChild(li);

      inputs[key] = input;
    }

    return inputs;
  }

  getConflict(shortcuts, currentKey, val) {
    const display = formatComboLabel(val);

    // Check against other configurable shortcuts
    for (const [otherKey, otherVal] of Object.entries(shortcuts)) {
      if (otherKey !== currentKey && otherVal === val) {
        return `"${display}" is already used by ${formatKey(otherKey)}`;
      }
    }
    // Check against hardcoded keys
    if (RESERVED_KEYS.has(val)) {
      return `"${display}" is reserved for: ${RESERVED_KEYS.get(val)}`;
    }
    return null;
  }

  showShortcutError(inputEl, msg) {
    inputEl?.classList.add('conflict');
    if (this.errorEl) this.errorEl.style.display = '';
    if (this.errorMsg) this.errorMsg.textContent = msg;
  }

  clearShortcutError(inputEl) {
    inputEl?.classList.remove('conflict');
    if (this.errorEl) this.errorEl.style.display = 'none';
    if (this.errorMsg) this.errorMsg.textContent = '';
  }

  initHistory() {
    this.clearButton.addEventListener('click', () => {
      this.history.clear();
    });

    const isPersistent = this.config.get('history');
    this.persistentButton.checked = isPersistent;
    this.persistentButton.addEventListener('click', () => {
      this.config.set('history', this.persistentButton.checked);
      this.signals.historyChanged.dispatch();
    });

    this.updateHistoryList(this.history);

    this.signals.historyChanged.add(() => this.updateHistoryList(this.history));
  }

  updateHistoryList(history) {
    this.historyList.innerHTML = '';

    const undoList = history.undos.slice();
    undoList.forEach((cmd, index) => {
      const li = document.createElement('li');
      li.className = 'outliner-item';
      li.textContent = cmd.name || 'Unnamed Command';
      li.dataset.index = index;
      li.dataset.type = 'undo';
      li.addEventListener('click', () => {
        this.jumpToHistory(index, 'undo');
      });
      this.historyList.appendChild(li);
    });

    const redoList = history.redos.slice().reverse();
    redoList.forEach((cmd, index) => {
      const li = document.createElement('li');
      li.className = 'outliner-item';
      li.style.opacity = 0.5;
      li.textContent = cmd.name || 'Unnamed Command';
      li.dataset.index = index;
      li.dataset.type = 'redo';
      li.addEventListener('click', () => {
        this.jumpToHistory(index, 'redo', redoList.length);
      });
      this.historyList.appendChild(li);
    });
  }

  jumpToHistory(index, type, redoLength = 0) {
    if (type === 'undo') {
      while (this.history.undos.length > index + 1) {
        this.history.undo();
      }
    } else if (type === 'redo') {
      const targetRedoIndex = redoLength - index - 1;
      while (this.history.redos.length > targetRedoIndex) {
        this.history.redo();
      }
    }
  }
}