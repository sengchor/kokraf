import * as THREE from 'three';

const RESERVED_KEYS = new Map([
  ['tab', 'Switch mode'],
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
    const errorEl = document.getElementById('shortcut-error');
    const errorMsg = errorEl?.querySelector('.shortcut-error-msg');

    const inputs = this.generateShortcutsList(shortcuts, list);

    const showError = (inputEl, msg) => {
      inputEl.classList.add('conflict');
      if (errorEl) errorEl.style.display = '';
      if (errorMsg) errorMsg.textContent = msg;
    };

    const clearError = (inputEl) => {
      inputEl.classList.remove('conflict');
      if (errorEl) errorEl.style.diplay = 'none';
      if (errorMsg) errorMsg.textContent = '';
    }

    for (const key of Object.keys(shortcuts)) {
      const input = inputs[key];
      let prevVal = input.value;

      input.addEventListener('focus', () => clearError(input));

      input.addEventListener('input', () => {
        const val = input.value.toLowerCase().trim();
        input.value = val;
        if (!val) { clearError(input); return; }

        const conflict = this.getConflict(shortcuts, key, val);
        if (conflict) { showError(input, conflict); return; }

        clearError(input);
        prevVal = val;
        shortcuts[key] = val;
        this.config.save();
      });

      input.addEventListener('blur', () => {
        if (input.classList.contains('conflict')) {
          input.value = prevVal;
          clearError(input);
        }
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          input.blur();
        }
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
      label.textContent = key.charAt(0).toUpperCase() + key.slice(1);

      const input = document.createElement('input');
      input.className = 'key-input';
      input.type = 'text';
      input.maxLength = 1;
      input.value = shortcuts[key] ?? '';
      input.id = `${key}-shortcut`;

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
        const label = otherKey.charAt(0).toUpperCase() + otherKey.slice(1);
        return `"${val}" is already used by ${label}`;
      }
    }
    // Check against hardcoded keys
    if (RESERVED_KEYS.has(val)) {
      return `"${val}" is reserved for: ${RESERVED_KEYS.get(val)}`;
    }
    return null;
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