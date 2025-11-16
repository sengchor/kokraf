import { MeshDataCommand } from './MeshDataCommand.js';

export class KnifeCommand extends MeshDataCommand {
  static type = 'KnifeCommand';
  constructor(editor, object, beforeMeshData, afterMeshData) {
    super(editor, object, beforeMeshData, afterMeshData, 'Knife');
  }
}