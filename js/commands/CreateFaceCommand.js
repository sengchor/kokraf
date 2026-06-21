import { MeshDeltaCommand } from './MeshDeltaCommand.js';

export class CreateFaceCommand extends MeshDeltaCommand {
  static type = 'CreateFaceCommand';
  constructor(editor, object, beforeDelta, afterDelta) {
    super(editor, object, beforeDelta, afterDelta, 'Create Face');
  }
}