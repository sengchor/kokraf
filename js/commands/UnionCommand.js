import { MeshDataCommand } from './MeshDataCommand.js';

export class UnionCommand extends MeshDataCommand {
  static type = 'UnionCommand';
  constructor(editor, object, beforeMeshData, afterMeshData) {
    super(editor, object, beforeMeshData, afterMeshData, 'Union');
  }
}