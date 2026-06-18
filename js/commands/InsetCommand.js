import { MeshDeltaCommand } from './MeshDeltaCommand.js';

export class InsetCommand extends MeshDeltaCommand {
  static type = 'InsetCommand';
  constructor(editor, object, beforeDelta, afterDelta) {
    super(editor, object, beforeDelta, afterDelta, 'Inset Faces');
  }
}