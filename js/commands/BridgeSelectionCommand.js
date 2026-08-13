import { MeshDeltaCommand } from "./MeshDeltaCommand.js";

export class BridgeSelectionCommand extends MeshDeltaCommand {
  static type = 'BridgeSelectionCommand';
  constructor(editor, object, beforeDelta, afterDelta) {
    super(editor, object, beforeDelta, afterDelta, 'Bridge Selection');
  }
}