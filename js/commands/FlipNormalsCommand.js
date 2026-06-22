import { MeshDeltaCommand } from './MeshDeltaCommand.js';

export class FlipNormalsCommand extends MeshDeltaCommand {
  static type = 'FlipNormalsCommand';
  constructor(editor, object, beforeDelta, afterDelta) {
    super(editor, object, beforeDelta, afterDelta, 'Flip Normals');
  }
}