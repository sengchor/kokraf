import { MeshDataCommand } from './MeshDataCommand.js';

export class SplitSelectionCommand extends MeshDataCommand {
  static type = 'SplitSelectionCommand';
  constructor(editor, object, beforeMeshData, afterMeshData) {
    super(editor, object, beforeMeshData, afterMeshData, 'Split Selection');
  }
}