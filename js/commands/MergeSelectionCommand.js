import { MeshDeltaCommand } from './MeshDeltaCommand.js';

export class MergeSelectionCommand extends MeshDeltaCommand {
  static type = 'MergeSelectionCommand';
  constructor(editor, object, beforeDelta, afterDelta) {
    super(editor, object, beforeDelta, afterDelta, 'Merge Selection');
  }
}