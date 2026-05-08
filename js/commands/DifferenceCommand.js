import { MeshDataCommand } from './MeshDataCommand.js';

export class DifferenceCommand extends MeshDataCommand {
  static type = 'DifferenceCommand';
  constructor(editor, object, beforeMeshData, afterMeshData) {
    super(editor, object, beforeMeshData, afterMeshData, 'Difference');
  }
}