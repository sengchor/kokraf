import { MeshDataCommand } from './MeshDataCommand.js';

export class BevelCommand extends MeshDataCommand {
  static type = 'BevelCommand';
  constructor(editor, object, beforeMeshData, afterMeshData) {
    super(editor, object, beforeMeshData, afterMeshData, 'Bevel');
  }
}