import { MeshDeltaCommand } from './MeshDeltaCommand.js';

export class DuplicateSelectionCommand extends MeshDeltaCommand {
  static type = 'DuplicateSelectionCommand';
  constructor(editor, object, beforeDelta, afterDelta) {
    super(editor, object, beforeDelta, afterDelta, 'Duplicate Selection');
  }
}