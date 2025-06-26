import * as THREE from 'three';

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