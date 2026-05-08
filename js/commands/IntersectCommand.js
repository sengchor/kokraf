import { MeshDataCommand } from './MeshDataCommand.js';

export class IntersectCommand extends MeshDataCommand {
  static type = 'IntersectCommand';
  constructor(editor, object, beforeMeshData, afterMeshData) {
    super(editor, object, beforeMeshData, afterMeshData, 'Intersect');
  }
}