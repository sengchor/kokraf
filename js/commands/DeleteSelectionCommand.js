import { MeshDataCommand } from './MeshDataCommand.js';

export class DeleteSelectionCommand extends MeshDataCommand {
  static type = 'DeleteSelectionCommand';
  constructor(editor, object, beforeMeshData, afterMeshData) {
    super(editor, object, beforeMeshData, afterMeshData, 'Delete Selection');
  }
}