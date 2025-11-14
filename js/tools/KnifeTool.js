import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { VertexEditor } from '../tools/VertexEditor.js';

export class KnifeTool {
  constructor(editor) {
    this.editor = editor;
    this.camera = editor.cameraManager.camera;
    this.renderer = editor.renderer;
    this.scene = editor.sceneManager.sceneEditorHelpers;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.active = false;
    this.editSelection = editor.editSelection;
    this.cutPoints = [];
    this.intersections = [];
    this.edgeIntersections = [];

    this.previewLine = null;
    this.lineMaterial = new LineMaterial({
      color: 0xffff00,
      linewidth: 1.0,
      dashed: false,
      worldUnits: true,
      depthTest: false,
      worldUnits: false,
    });

    this.previewPoints;
    this.pointMaterial = new THREE.PointsMaterial({
      color: 0xffff00,
      size: 6,
      sizeAttenuation: false,
      depthTest: false,
      transparent: true,
      opacity: 0.8
    });

    this._onPointerDown = this.onPointerDown.bind(this);
    this._onPointerMove = this.onPointerMove.bind(this);
    this._onKeyDown = this.onKeyDown.bind(this);
  }

  enable() {
    if (this.active) return;
    this.active = true;
    this.cutPoints = [];
    this.intersections = [];
    this.edgeIntersections = [];
    this.editSelection.enable = false;
    this.renderer.domElement.addEventListener('pointerdown', this._onPointerDown);
    this.renderer.domElement.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('keydown', this._onKeyDown);
  }

  disable() {
    if (!this.active) return;
    this.active = false;
    this.editSelection.enable = true;
    this.cancelCut();
  }

  onPointerDown(event) {
    if (event.button !== 0 || !this.active) return;

    const intersect = this.getMouseIntersect(event);
    if (!intersect) return;

    // Store the first point
    if (this.cutPoints.length === 0) {
      this.cutPoints.push(intersect.point.clone());
      return;
    }

    // Second point click will finalize the cut
    const editedObject = this.editSelection.editedObject;
    const meshData = editedObject.userData.meshData;

    const a = this.cutPoints[0];
    const b = intersect.point.clone();
    this.cutPoints.push(b);

    this.computeNewVertices(a, b, meshData);
    this.updatePreview(a, b);

    this.applyCut();

    this.cutPoints.length = 0;
  }

  onPointerMove(event) {
    if (!this.active || this.cutPoints.length === 0) return;

    const intersect = this.getMouseIntersect(event);
    if (!intersect) return;

    const editedObject = this.editSelection.editedObject;
    const meshData = editedObject.userData.meshData;

    const a = this.cutPoints[0];
    const b = intersect.point.clone();

    this.computeNewVertices(a, b, meshData);
    this.updatePreview(a, b);
  }

  onKeyDown(event) {
    if (!this.active) return;

    if (event.key === 'Escape') {
      this.cancelCut();
    }
  }

  getMouseIntersect(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    const editedObject = this.editSelection.editedObject;
    if (!editedObject) return null;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const ray = this.raycaster.ray;

    const intersects = this.raycaster.intersectObject(editedObject, false);
    if (intersects.length > 0) {
      const hit = intersects[0];

      return hit;
    }

    // No hit → fallback point at object's center distance
    const objectWorldPos = new THREE.Vector3();
    editedObject.getWorldPosition(objectWorldPos);
    const distance = ray.origin.distanceTo(objectWorldPos);

    const fallbackPoint = new THREE.Vector3().copy(ray.origin).addScaledVector(ray.direction, distance);

    return {
      point: fallbackPoint,
      distance: distance,
      object: null,
      face: null,
      isFallback: true,
    };
  }

  computeNewVertices(a, b, meshData) {
    this.intersections = [];
    this.edgeIntersections = [];

    const midPoint = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    const cameraPos = new THREE.Vector3().copy(this.camera.position);
    const cameraDir = new THREE.Vector3().subVectors(cameraPos, midPoint).normalize();
    const segmentDir = new THREE.Vector3().subVectors(b, a).normalize();

    const planeNormal = new THREE.Vector3().crossVectors(segmentDir, cameraDir).normalize();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, a);

    const editedObject = this.editSelection.editedObject;
    const objectMatrix = editedObject.matrixWorld;

    for (let edge of meshData.edges.values()) {
      const v1 = meshData.getVertex(edge.v1Id);
      const v2 = meshData.getVertex(edge.v2Id);

      const p1 = new THREE.Vector3(v1.position.x, v1.position.y, v1.position.z).applyMatrix4(objectMatrix);
      const p2 = new THREE.Vector3(v2.position.x, v2.position.y, v2.position.z).applyMatrix4(objectMatrix);

      const line = new THREE.Line3(p1, p2);
      const intersection = plane.intersectLine(line, new THREE.Vector3());
      if (!intersection) continue;

      // Front Intersection Only
      const dirToCamera = new THREE.Vector3().subVectors(cameraPos, intersection).normalize();
      const offset = 1e-4;
      const start = new THREE.Vector3().addVectors(intersection, dirToCamera.clone().multiplyScalar(offset));

      this.raycaster.set(start, dirToCamera);
      this.raycaster.far = intersection.distanceTo(cameraPos) - offset;

      const hits = this.raycaster.intersectObject(this.editSelection.editedObject, true);

      if (hits.length > 0 && hits[0].distance < this.raycaster.far) {
        continue;
      }

      const withinSegment = this.isIntersectionWithinScreenSegment(a, b, intersection, this.camera);

      if (withinSegment) {
        this.intersections.push(intersection);
        this.edgeIntersections.push(edge);
      }
    }
  }

  applyCut() {
    if (this.intersections.length === 0) return this.cancelCut();

    const editedObject = this.editSelection.editedObject;
    if (!editedObject) return;
    const meshData = editedObject.userData.meshData;
    const worldToLocal = new THREE.Matrix4().copy(editedObject.matrixWorld).invert();

    const newVertices = [];
    for (const pos of this.intersections) {
      const localPos = pos.clone().applyMatrix4(worldToLocal);
      newVertices.push(meshData.addVertex({ x: localPos.x, y: localPos.y, z: localPos.z }));
    }

    // Collect affected faces
    const affectedFaces = new Set();
    for (const edge of this.edgeIntersections) {
      for (const faceId of edge.faceIds) {
        const face = meshData.faces.get(faceId);
        if (face) affectedFaces.add(face);
      }
    }

    for (const face of affectedFaces) {
      const vertexIds = face.vertexIds;
      const cutPoints = [];

      // Find edges of this face that were cut
      for (let i = 0; i < vertexIds.length; i++) {
        const v1 = vertexIds[i];
        const v2 = vertexIds[(i + 1) % vertexIds.length];
        const edge = meshData.getEdge(v1, v2);

        const intersectionIndex = this.edgeIntersections.findIndex(e => e.id === edge?.id);
        if (intersectionIndex !== -1) {
          cutPoints.push({ edgeIndex: i, newVertex: newVertices[intersectionIndex] });
        }
      }

      if (cutPoints.length === 0) continue;

      meshData.deleteFace(face);

      if (cutPoints.length === 1) {
        const { edgeIndex, newVertex } = cutPoints[0];
        const newFaceVerts = [];
        for (let i = 0; i < vertexIds.length; i++) {
          newFaceVerts.push(meshData.getVertex(vertexIds[i]));
          if (i === edgeIndex) {
            newFaceVerts.push(newVertex);
          }
        }

        meshData.addFace(newFaceVerts);
      } else if (cutPoints.length === 2) {
        const [cutA, cutB] = cutPoints;

        const firstFaceVertices = this.buildFaceFromCuts(vertexIds, meshData, [cutA, cutB]);
        const secondFaceVertices = this.buildFaceFromCuts(vertexIds, meshData, [cutB, cutA]);

        meshData.addFace(firstFaceVertices);
        meshData.addFace(secondFaceVertices);
      }
    }

    // Remove all intersected edges
    for (const edge of this.edgeIntersections) {
      meshData.deleteEdge(edge);
    }

    const vertexEditor = new VertexEditor(this.editor, editedObject);
    vertexEditor.applyMeshData(meshData);
    vertexEditor.updateGeometryAndHelpers();

    this.editSelection.selectVertices(newVertices.map(v => v.id));
    this.cancelCut();
  }

  cancelCut() {
    this.scene.remove(this.previewLine);
    this.scene.remove(this.previewPoints);
    this.cutPoints = [];
    this.intersections = [];
    this.edgeIntersections = [];
  }

  updatePreview(a, b) {
    // --- Preview Line ---
    const positions = [a.x, a.y, a.z, b.x, b.y, b.z];
    const geometry = new LineGeometry();
    geometry.setPositions(positions);

    if (this.previewLine) {
      this.scene.remove(this.previewLine);
      this.previewLine.geometry.dispose();
    }

    this.previewLine = new Line2(geometry, this.lineMaterial);
    this.previewLine.computeLineDistances();
    this.previewLine.scale.set(1, 1, 1);
    this.scene.add(this.previewLine);

    // --- Preview Points ---
    if (this.previewPoints) {
      this.scene.remove(this.previewPoints);
      this.previewPoints.geometry.dispose();
      this.previewPoints.material.dispose();
    }

    const pointPositions = [];
    this.intersections.forEach(v => {
      pointPositions.push(v.x, v.y, v.z);
    });

    const pointGeometry = new THREE.BufferGeometry();
    pointGeometry.setAttribute('position', new THREE.Float32BufferAttribute(pointPositions, 3));

    this.previewPoints = new THREE.Points(pointGeometry, this.pointMaterial);
    this.scene.add(this.previewPoints);
  }

  isIntersectionWithinScreenSegment(a, b, intersection, camera) {
    const ndcA = a.clone().project(camera);
    const ndcB = b.clone().project(camera);
    const ndcI = intersection.clone().project(camera);

    const screenA = new THREE.Vector2(ndcA.x, ndcA.y);
    const screenB = new THREE.Vector2(ndcB.x, ndcB.y);
    const screenI = new THREE.Vector2(ndcI.x, ndcI.y);

    const ab = new THREE.Vector2().subVectors(screenB, screenA);
    const ai = new THREE.Vector2().subVectors(screenI, screenA);

    const abLen = ab.length();
    if (abLen === 0) return false;

    const projLen = ai.dot(ab.clone().normalize());

    const withinSegment = projLen >= 0 && projLen <= abLen;

    return withinSegment;
  }

  buildFaceFromCuts(vertexIds, meshData, cutPoints) {
    if (cutPoints.length !== 2) return [];

    const [startCut, endCut] = cutPoints;
    const verts = [startCut.newVertex];
    const startIndex = startCut.edgeIndex;
    const endIndex = endCut.edgeIndex;

    let i = (startIndex + 1) % vertexIds.length;
    while (i !== (endIndex + 1) % vertexIds.length) {
      verts.push(meshData.getVertex(vertexIds[i]));
      i = (i + 1) % vertexIds.length;
    }

    verts.push(endCut.newVertex);
    return verts;
  }
}