import { VertexDuplicate } from "./VertexDuplicate.js";
import { VertexDelete } from "./VertexDelete.js";
import { VertexDissolve } from "./VertexDissolve.js";
import { VertexTopologyUtils } from "./VertexTopologyUtils.js";
import { VertexTransform } from "./VertexTransform.js";

export class VertexEditor {
  constructor(editor) {
    this.editor = editor;
    this.object = null;

    this.topology = new VertexTopologyUtils(this);
    this.transform = new VertexTransform(this);
    this.duplicate = new VertexDuplicate(this);
    this.delete = new VertexDelete(this);
    this.dissolve = new VertexDissolve(this);
  }

  get meshData() {
    return this.object.userData.meshData;
  }

  setObject(object3D) {
    this.object = object3D || null;
  }
}