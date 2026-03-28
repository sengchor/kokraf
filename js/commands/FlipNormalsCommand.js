import { MeshDataCommand } from './MeshDataCommand.js';

export class FlipNormalsCommand extends MeshDataCommand {
  static type = 'FlipNormalsCommand';
  constructor(editor, object, beforeMeshData, afterMeshData) {
    super(editor, object, beforeMeshData, afterMeshData, 'Flip Normals');
  }
}