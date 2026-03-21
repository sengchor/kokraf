import { MeshDataCommand } from './MeshDataCommand.js';

export class EdgeSlideCommand extends MeshDataCommand {
  static type = 'EdgeSlideCommand';
  constructor(editor, object, beforeMeshData, afterMeshData) {
    super(editor, object, beforeMeshData, afterMeshData, 'Edge Slide');
  }
}