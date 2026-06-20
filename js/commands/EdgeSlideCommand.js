import { MeshDeltaCommand } from './MeshDeltaCommand.js';

export class EdgeSlideCommand extends MeshDeltaCommand {
  static type = 'EdgeSlideCommand';
  constructor(editor, object, beforeDelta, afterDelta) {
    super(editor, object, beforeDelta, afterDelta, 'Edge Slide');
  }
}