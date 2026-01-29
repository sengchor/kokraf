export class SequentialMultiCommand {
  static type = 'SequentialMultiCommand';

  constructor(editor, name = 'Multiple Commands') {
    this.editor = editor;
    this.name = name;

    this.factories = [];
    this.commands = [];
    this.hasExecuted = false;
  }

  /**
   * Add a command factory instead of a command
   * @param {() => Command} factory
   */
  add(factory) {
    if (typeof factory !== 'function') return;
    this.factories.push(factory);
  }

  execute() {
    if (!this.hasExecuted) {
      for (const factory of this.factories) {
        const cmd = factory();
        if (!cmd) continue;

        cmd.execute();
        this.commands.push(cmd);
      }

      this.hasExecuted = true;
      this.factories.length = 0;
      return;
    }

    for (const cmd of this.commands) {
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
      type: SequentialMultiCommand.type,
      name: this.name,
      commands: this.commands.map(cmd => cmd.toJSON())
    };
  }

  static fromJSON(editor, json, commandMap) {
    const multi = new SequentialMultiCommand(editor, json.name);

    multi.commands = json.commands
      .map(data => {
        const CommandClass = commandMap.get(data.type);
        if (!CommandClass || typeof CommandClass.fromJSON !== 'function') {
          console.warn(`Unknown command in SequentialMultiCommand: ${data.type}`);
          return null;
        }
        return CommandClass.fromJSON(editor, data);
      }).filter(Boolean);
    
    multi.hasExecuted = true;
    return multi;
  }
}