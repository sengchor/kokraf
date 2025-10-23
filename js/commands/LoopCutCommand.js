import { MeshDataCommand } from './MeshDataCommand.js';

export class LoopCutCommand extends MeshDataCommand {
  static type = 'LoopCutCommand';
  constructor(editor, object, beforeMeshData, afterMeshData) {
    super(editor, object, beforeMeshData, afterMeshData, 'Loop Cut');
  }
}