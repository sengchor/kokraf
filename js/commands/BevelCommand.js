import { MeshDeltaCommand } from './MeshDeltaCommand.js';

export class BevelCommand extends MeshDeltaCommand {
  static type = 'BevelCommand';
  constructor(editor, object, beforeDelta, afterDelta) {
    super(editor, object, beforeDelta, afterDelta, 'Bevel');
  }
}