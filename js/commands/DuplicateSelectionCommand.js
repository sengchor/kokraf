import { MeshDataCommand } from './MeshDataCommand.js';

export class DuplicateSelectionCommand extends MeshDataCommand {
  static type = 'DuplicateSelectionCommand';
  constructor(editor, object, beforeMeshData, afterMeshData) {
    super(editor, object, beforeMeshData, afterMeshData, 'Duplicate Selection');
  }
}