import { MeshDataCommand } from './MeshDataCommand.js';

export class ExtrudeCommand extends MeshDataCommand {
  static type = 'ExtrudeCommand';
  constructor(editor, object, beforeMeshData, afterMeshData) {
    super(editor, object, beforeMeshData, afterMeshData, 'Extrude');
  }
}