import * as THREE from 'three';

const RESERVED_KEYS = new Map([
  ['tab', 'Switch mode'],
  ['shift', 'Multi-select'],
  ['ctrl+c', 'Copy'],
  ['ctrl+v', 'Paste'],
  ['delete', 'Delete'],
  ['shift+a', 'Add Context Menu'],
  ['ctrl+a', 'Apply Context Menu'],
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

    for (const key of Object.keys(shortcuts)) {
      const input = inputs[key];
      let prevVal = input.value;
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
          input.value = prevVal;
          this.clearShortcutError(input);
          input.blur();
          return;
        }
        if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

        e.preventDefault();

        // Build combo string
        const parts = [];
        if (e.ctrlKey) parts.push('ctrl');
        if (e.shiftKey) parts.push('shift');
        if (e.altKey) parts.push('alt');
        parts.push(e.key.toLowerCase());
        const val = parts.join('+');

        input.value = val;
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
          input.value = prevVal;
          this.clearShortcutError(input);
          pendingVal = null;
          return;
        }

        prevVal = pendingVal;
        shortcuts[key] = pendingVal;
        pendingVal = null;
        this.config.save();
      });
    }
  }

  generateShortcutsList(shortcuts, list) {
    const inputs = {};

    for (const key of Object.keys(shortcuts)) {
      const li = document.createElement('li');
      li.className = 'setting-option';

      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = this.formatKey(key);

      const input = document.createElement('input');
      input.className = 'key-input';
      input.type = 'text';
      input.value = shortcuts[key] ?? '';
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
    // Check against other configurable shortcuts
    for (const [otherKey, otherVal] of Object.entries(shortcuts)) {
      if (otherKey !== currentKey && otherVal === val) {
        const label = this.formatKey(otherKey);
        return `"${val}" is already used by ${label}`;
      }
    }
    // Check against hardcoded keys
    if (RESERVED_KEYS.has(val)) {
      return `"${val}" is reserved for: ${RESERVED_KEYS.get(val)}`;
    }
    return null;
  }

  showShortcutError(inputEl, msg) {
    inputEl.classList.add('conflict');
    if (this.errorEl) this.errorEl.style.display = '';
    if (this.errorMsg) this.errorMsg.textContent = msg;
  };

  clearShortcutError(inputEl) {
    inputEl.classList.remove('conflict');
    if (this.errorEl) this.errorEl.style.display = 'none';
    if (this.errorMsg) this.errorMsg.textContent = '';
  };

  formatKey(key) {
    return key
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/^./, c => c.toUpperCase());
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
    })
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