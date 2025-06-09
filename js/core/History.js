export class History {
  constructor(editor) {
    this.editor = editor;
    this.undos = [];
    this.redos = [];
  }

  execute(cmd) {
    cmd.execute();
    this.undos.push(cmd);
    this.redos.length = 0;
  }

  undo() {
    const cmd = this.undos.pop();
    if (cmd) {
      cmd.undo();
      this.redos.push(cmd);
    }
  }

  redo() {
    const cmd = this.redos.pop();
    if (cmd) {
      cmd.execute();
      this.undos.push(cmd);
    }
  }
}