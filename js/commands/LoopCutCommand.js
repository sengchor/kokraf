import { MeshDeltaCommand } from './MeshDeltaCommand.js';

export class LoopCutCommand extends MeshDeltaCommand {
  static type = 'LoopCutCommand';
  constructor(editor, object, beforeDelta, afterDelta) {
    super(editor, object, beforeDelta, afterDelta, 'Loop Cut');
  }
}