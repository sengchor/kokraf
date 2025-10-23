import { MeshDataCommand } from './MeshDataCommand.js';

export class CreateFaceCommand extends MeshDataCommand {
  static type = 'CreateFaceCommand';
  constructor(editor, object, beforeMeshData, afterMeshData) {
    super(editor, object, beforeMeshData, afterMeshData, 'Create Face');
  }
}