export class History {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.undos = [];
    this.redos = [];
  }

  execute(cmd) {
    cmd.execute();
    this.undos.push(cmd);
    this.redos.length = 0;
    this.signals.historyChanged.dispatch();
  }

  undo() {
    const cmd = this.undos.pop();
    if (cmd) {
      cmd.undo();
      this.redos.push(cmd);
      this.signals.historyChanged.dispatch();
    }
  }

  redo() {
    const cmd = this.redos.pop();
    if (cmd) {
      cmd.execute();
      this.undos.push(cmd);
      this.signals.historyChanged.dispatch();
    }
  }

  clear() {
    this.undos.length = 0;
    this.redos.length = 0;
    this.signals.historyChanged.dispatch();
  }
}