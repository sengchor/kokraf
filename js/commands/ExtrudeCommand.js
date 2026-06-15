import { MeshDeltaCommand } from './MeshDeltaCommand.js';

export class ExtrudeCommand extends MeshDeltaCommand {
  static type = 'ExtrudeCommand';
  constructor(editor, object, beforeDelta, afterDelta) {
    super(editor, object, beforeDelta, afterDelta, 'Extrude');
  }
}