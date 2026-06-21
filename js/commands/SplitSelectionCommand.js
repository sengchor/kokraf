import { MeshDeltaCommand } from './MeshDeltaCommand.js';

export class SplitSelectionCommand extends MeshDeltaCommand {
  static type = 'SplitSelectionCommand';
  constructor(editor, object, beforeDelta, afterDelta) {
    super(editor, object, beforeDelta, afterDelta, 'Split Selection');
  }
}