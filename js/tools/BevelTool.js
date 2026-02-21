import * as THREE from 'three';
import { TransformControls } from 'jsm/controls/TransformControls.js';
import { getEdgeMidpoint, calculateFaceNormal } from '../utils/AlignedNormalUtils.js';

export class BevelTool {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;

    this.vertexEditor = editor.vertexEditor;
    this.camera = editor.cameraManager.camera;
    this.renderer = editor.renderer;
    this.controls = editor.controlsManager;
    this.editSelection = editor.editSelection;
    this.sceneEditorHelpers = editor.sceneManager.sceneEditorHelpers;

    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.setMode('translate');
    this.transformControls.visible = false;

    this.renderer.domElement.addEventListener('pointermove', (e) => this.event = e);
    this.sceneEditorHelpers.add(this.transformControls.getHelper());

    this.setupTransformListeners();
  }

  enableFor(object) {
    if (!object) return;

    this.transformControls.attach(object);
    this.transformControls.visible = true;

    this.showCenterOnly();
    this.handle = this.transformControls.object;
  }

  disable() {
    this.transformControls.detach();
    this.transformControls.visible = false;
  }

  showCenterOnly() {
    const helper = this.transformControls.getHelper();
    helper.traverse(child => {
      if (!child.isMesh || !child.name) return;
      if (child.name === 'Z' || child.name === 'Y' || child.name === 'X') {
        child.material.visible = false;
      }
      if (child.name === 'XY' || child.name === 'XZ' || child.name === 'YZ') {
        child.material.visible = false;
      }
    });

    const picker = this.transformControls._gizmo.picker.translate;
    for (let i = picker.children.length - 1; i >= 0; i--) {
      const child = picker.children[i];
      if (child.name !== 'XYZ') {
          picker.remove(child);
      }
    }
  }

  setupTransformListeners() {
    this.transformControls.addEventListener('mouseDown', () => {
      this.startBevelSession();
    });

    this.transformControls.addEventListener('change', () => {
      if (!this.transformControls.dragging) return;
      this.applyBevelSession();
    });

    this.transformControls.addEventListener('mouseUp', () => {
      this.commitBevelSession();
    });

    // Signal dispatch
    this.transformControls.addEventListener('dragging-changed', (event) => {
      this.controls.enabled = !event.value;
      if (!event.value) this.signals.objectChanged.dispatch();
    });

    this.transformControls.addEventListener('mouseDown', () => {
      this.signals.transformDragStarted.dispatch('edit');
    });

    this.transformControls.addEventListener('mouseUp', () => {
      requestAnimationFrame(() => {
        this.editSelection.updateVertexHandle();
        this.signals.transformDragEnded.dispatch('edit');
      });
    });
  }

  // Bevel session
  startBevelSession() {
    const editedObject = this.editSelection.editedObject;
    if (!editedObject || !this.handle) return;

    this.startPivotPosition = this.handle.getWorldPosition(new THREE.Vector3());
    this.extrudeStarted = false;
  }

  applyBevelSession() {
    if (!this.startPivotPosition) return;

    if (!this.extrudeStarted) {
      this.startBevel();
      this.extrudeStarted = true;
    }
    this.updateBevel();
  }

  commitBevelSession() {
    this.commitBevel();

    const editedObject = this.editSelection.editedObject;
    this.vertexEditor.setObject(editedObject);
    this.vertexEditor.transform.updateGeometryAndHelpers();

    if (!this.bridgeFace) return;
    this.editSelection.selectVertices(this.bridgeFace.vertexIds);
  }

  startBevel() {
    const editedObject = this.editSelection.editedObject;
    if (!editedObject) return;

    const meshData = editedObject.userData.meshData;
    if (!meshData) return;

    const selectedEdgeIds = Array.from(this.editSelection.selectedEdgeIds);
    if (selectedEdgeIds.length !== 1) return;

    const edge = meshData.edges.get(selectedEdgeIds[0]);
    if (!edge || edge.faceIds.size !== 2) return;

    const [faceId1, faceId2] = Array.from(edge.faceIds);

    const face1 = meshData.faces.get(faceId1);
    const face2 = meshData.faces.get(faceId2);

    const v1 = meshData.getVertex(edge.v1Id);
    const v2 = meshData.getVertex(edge.v2Id);

    this.bevelData = {
      meshData, edge, face1, face2, v1, v2, distance: 0, newVertices: null
    };
  }

  updateBevel() {
    // Compute drag distance
    const currentPos = this.handle.getWorldPosition(new THREE.Vector3());
    const delta = currentPos.clone().sub(this.startPivotPosition);
    this.distance = delta.length();

    if (this.distance === 0) return;
  }

  commitBevel() {
    const editedObject = this.editSelection.editedObject;
    if (!editedObject) return;
    if (!this.bevelData) return;

    const {
      meshData, edge, face1, face2, v1, v2
    } = this.bevelData;
    const worldMatrix = editedObject.matrixWorld;

    // Compute edge direction
    const p1 = new THREE.Vector3().copy(v1.position).applyMatrix4(worldMatrix);
    const p2 = new THREE.Vector3().copy(v2.position).applyMatrix4(worldMatrix);

    const edgeDir = p2.clone().sub(p1).normalize();
    
    // Compute face normals
    const normal1 = calculateFaceNormal(meshData, face1);
    const normal2 = calculateFaceNormal(meshData, face2);

    let offsetDir1 = new THREE.Vector3().crossVectors(edgeDir, normal1).normalize();
    let offsetDir2 = new THREE.Vector3().crossVectors(edgeDir, normal2).normalize();

    offsetDir1 = this.orientOffsetToInterior(meshData, face1, edge, offsetDir1);
    offsetDir2 = this.orientOffsetToInterior(meshData, face2, edge, offsetDir2);

    const newV1A = p1.clone().add(offsetDir1.clone().multiplyScalar(this.distance));
    const newV2A = p2.clone().add(offsetDir1.clone().multiplyScalar(this.distance));

    const newV1B = p1.clone().add(offsetDir2.clone().multiplyScalar(this.distance));
    const newV2B = p2.clone().add(offsetDir2.clone().multiplyScalar(this.distance));

    // Remove original faces
    meshData.deleteFace(face1);
    meshData.deleteFace(face2);

    const nv1A = meshData.addVertex(newV1A);
    const nv2A = meshData.addVertex(newV2A);
    const nv1B = meshData.addVertex(newV1B);
    const nv2B = meshData.addVertex(newV2B);
    const bridgeFaceVerts = [nv1B, nv2B, nv2A, nv1A];

    // ---- FACE 1 INSET ----
    const newFace1Verts = this.replaceEdgeVerticesInFace(meshData, face1, edge, nv1A, nv2A);
    meshData.addFace(newFace1Verts);

    // ---- FACE 2 INSET ----
    const newFace2Verts = this.replaceEdgeVerticesInFace(meshData, face2, edge, nv1B, nv2B);
    meshData.addFace(newFace2Verts);

    // Bridge face
    this.bridgeFace = this.createBridgeFace(meshData, normal1, normal2, bridgeFaceVerts);

    meshData.deleteEdge(edge);

    const affectedFacesV1 = Array.from(v1.faceIds);
    const affectedFacesV2 = Array.from(v2.faceIds);

    for (const faceId of affectedFacesV1) {
      const face = meshData.faces.get(faceId);
      this.splitVertexInFace(meshData, face, v1, nv1A, nv1B);
    }

    for (const faceId of affectedFacesV2) {
      const face = meshData.faces.get(faceId);
      this.splitVertexInFace(meshData, face, v2, nv2A, nv2B);
    }

    meshData.deleteVertex(v1);
    meshData.deleteVertex(v2);
  }

  replaceEdgeVerticesInFace(meshData, face, edge, newV1, newV2) {
    const result = [];

    for (const vId of face.vertexIds) {
      if (vId === edge.v1Id) {
        result.push(newV1);
      } else if (vId === edge.v2Id) {
        result.push(newV2);
      } else {
        result.push(meshData.getVertex(vId));
      }
    }

    return result;
  }

  getAdjacentVertexInFace(face, edge) {
    const vIds = face.vertexIds;
    const len = vIds.length;

    const i1 = vIds.indexOf(edge.v1Id);
    const i2 = vIds.indexOf(edge.v2Id);

    if (i1 === -1 || i2 === -1) return null;

    if ((i1 + 1) % len === i2) {
      return vIds[(i1 - 1 + len) % len];
    }

    if ((i2 + 1) % len === i1) {
      return vIds[(i2 - 1 + len) % len];
    }

    return null;
  }

  orientOffsetToInterior(meshData, face, edge, offsetDir) {
    const adjacentId = this.getAdjacentVertexInFace(face, edge);
    const adjacentVertex = meshData.getVertex(adjacentId);
    const midpoint = getEdgeMidpoint(edge, meshData);

    const adjacentPosition = new THREE.Vector3().copy(adjacentVertex.position);
    const toInterior = adjacentPosition.sub(midpoint).normalize();

    if (offsetDir.dot(toInterior) < 0) {
      offsetDir.negate();
    }
    return offsetDir;
  }

  createBridgeFace(meshData, normal1, normal2, bridgeVerts) {
    const face = meshData.addFace(bridgeVerts);
    
    const targetNormal = new THREE.Vector3().addVectors(normal1, normal2).normalize();
    const currentNormal = calculateFaceNormal(meshData, face);

    if (currentNormal.dot(targetNormal) < 0) {
      meshData.deleteFace(face);
      return meshData.addFace([...bridgeVerts].reverse());
    }
    
    return face;
  }

  splitVertexInFace(meshData, face, oldVertex, nvA, nvB) {
    const vIds = face.vertexIds;
    const oldIdx = vIds.indexOf(oldVertex.id);
    if (oldIdx === -1) return;

    const prevV = meshData.getVertex(vIds[(oldIdx - 1 + vIds.length) % vIds.length]);
    
    const dirToPrev = new THREE.Vector3().subVectors(prevV.position, oldVertex.position).normalize();
    const dirToA = new THREE.Vector3().subVectors(nvA.position, oldVertex.position).normalize();
    const dirToB = new THREE.Vector3().subVectors(nvB.position, oldVertex.position).normalize();

    // The new vertex that aligns better with the "previous" vertex comes first
    const dotA = dirToPrev.dot(dirToA);
    const dotB = dirToPrev.dot(dirToB);

    const [first, second] = (dotA > dotB) ? [nvA, nvB] : [nvB, nvA];

    const newIds = [...vIds];
    newIds.splice(oldIdx, 1, first.id, second.id);

    meshData.deleteFace(face);
    meshData.addFace(newIds.map(id => meshData.getVertex(id)));
  }
}