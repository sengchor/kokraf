import { MeshDataCommand } from './MeshDataCommand.js';

export class SubdivideSelectionCommand extends MeshDataCommand {
  static type = 'SubdivideSelectionCommand';
  constructor(editor, object, beforeMeshData, afterMeshData) {
    super(editor, object, beforeMeshData, afterMeshData, 'Subdivide Selection');
  }
}