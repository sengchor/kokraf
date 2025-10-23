import { MeshDataCommand } from './MeshDataCommand.js';

export class SeparateSelectionCommand extends MeshDataCommand {
  static type = 'SeparateSelectionCommand';
  constructor(editor, object, beforeMeshData, afterMeshData) {
    super(editor, object, beforeMeshData, afterMeshData, 'Separate Selection');
  }
}