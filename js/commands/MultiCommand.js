export class MultiCommand {
  static type = 'MultiCommand';

  constructor(editor, name = 'Multiple Commands') {
    this.editor = editor;
    this.name = name;
    this.commands = [];
  }

  add(cmd) {
    if (cmd) this.commands.push(cmd);
  }

  execute() {
    for (let cmd of this.commands) {
      cmd.execute();
    }
  }

  undo() {
    for (let i = this.commands.length - 1; i >= 0; i--) {
      this.commands[i].undo();
    }
  }

  toJSON() {
    return {
      type: MultiCommand.type,
      name: this.name,
      commands: this.commands.map(cmd => cmd.toJSON())
    };
  }

  static fromJSON(editor, json, commandMap) {
    const multi = new MultiCommand(editor, json.name);

    multi.commands = json.commands
      .map(data => {
        const CommandClass = commandMap.get(data.type);
        if (!CommandClass || typeof CommandClass.fromJSON !== 'function') {
          console.warn(`Unknown command in MultiCommand: ${data.type}`);
          return null;
        }
        return CommandClass.fromJSON(editor, data);
      }).filter(Boolean);

    return multi;
  }
}