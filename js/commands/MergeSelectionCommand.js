import { MeshDataCommand } from './MeshDataCommand.js';

export class MergeSelectionCommand extends MeshDataCommand {
  static type = 'MergeSelectionCommand';
  constructor(editor, object, beforeMeshData, afterMeshData) {
    super(editor, object, beforeMeshData, afterMeshData, 'Merge Selection');
  }
}