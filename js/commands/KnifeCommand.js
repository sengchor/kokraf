import { MeshDeltaCommand } from './MeshDeltaCommand.js';

export class KnifeCommand extends MeshDeltaCommand {
  static type = 'KnifeCommand';
  constructor(editor, object, beforeDelta, afterDelta) {
    super(editor, object, beforeDelta, afterDelta, 'Knife');
  }
}