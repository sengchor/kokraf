import { MeshDeltaCommand } from './MeshDeltaCommand.js';

export class SubdivideSelectionCommand extends MeshDeltaCommand {
  static type = 'SubdivideSelectionCommand';
  constructor(editor, object, beforeDelta, afterDelta) {
    super(editor, object, beforeDelta, afterDelta, 'Subdivide Selection');
  }
}