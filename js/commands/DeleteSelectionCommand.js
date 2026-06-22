import { MeshDeltaCommand } from './MeshDeltaCommand.js';

export class DeleteSelectionCommand extends MeshDeltaCommand {
  static type = 'DeleteSelectionCommand';
  constructor(editor, object, beforeDelta, afterDelta) {
    super(editor, object, beforeDelta, afterDelta, 'Delete Selection');
  }
}