import { commands } from '../commands/Commands.js'

export class History {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.undos = [];
    this.redos = [];
    this.maxCommands = 25;
  }

  execute(cmd) {
    cmd.execute();
    this.undos.push(cmd);
    this.redos.length = 0;

    while (this.undos.length + this.redos.length > this.maxCommands) {
      this.undos.shift();
    }

    this.signals.historyChanged.dispatch();
  }

  undo() {
    const cmd = this.undos.pop();
    if (cmd) {
      cmd.undo();
      this.redos.push(cmd);

      while (this.undos.length + this.redos.length > this.maxCommands) {
        this.redos.shift();
      }

      this.signals.historyChanged.dispatch();
    }
  }

  redo() {
    const cmd = this.redos.pop();
    if (cmd) {
      cmd.execute();
      this.undos.push(cmd);

      while (this.undos.length + this.redos.length > this.maxCommands) {
        this.undos.shift();
      }

      this.signals.historyChanged.dispatch();
    }
  }

  clear() {
    this.undos.length = 0;
    this.redos.length = 0;
    this.signals.historyChanged.dispatch();
  }

  toJSON() {
    return {
      undos: this.undos.map(cmd => cmd.toJSON()),
      redos: this.redos.map(cmd => cmd.toJSON())
    }
  }

  fromJSON(json) {
    this.clear();
    if (!json) return;

    const revive = (arr) => arr.map(data => {
      const CommandClass = commands.get(data.type);
      if (!CommandClass || typeof CommandClass.fromJSON !== 'function') {
        console.warn(`Unknown command: ${data.type}`);
        return null;
      }

      if (CommandClass.fromJSON.length === 3) {
        return CommandClass.fromJSON(this.editor, data, commands);
      } else {
        return CommandClass.fromJSON(this.editor, data);
      }
    }).filter(Boolean);
    
    this.undos = revive(json.undos);
    this.redos = revive(json.redos);
  }
}