import { MeshDataCommand } from './MeshDataCommand.js';

export class InsetCommand extends MeshDataCommand {
  static type = 'InsetCommand';
  constructor(editor, object, beforeMeshData, afterMeshData) {
    super(editor, object, beforeMeshData, afterMeshData, 'Inset Faces');
  }
}