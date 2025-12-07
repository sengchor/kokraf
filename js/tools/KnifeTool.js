import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { KnifeCommand } from '../commands/KnifeCommand.js';

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
    this.newVertices = [];

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

    const editedObject = this.editSelection.editedObject;
    const objectMatrix = editedObject.matrixWorld;
    const meshData = editedObject.userData.meshData;

    const nearestVertexId = this.editSelection.pickNearestVertexOnMouse(event, this.renderer, this.camera, 0.02);

    let cutPointData;
    if (nearestVertexId !== null) {
      const v = meshData.getVertex(nearestVertexId);
      cutPointData = {
        position: new THREE.Vector3(v.position.x, v.position.y, v.position.z).applyMatrix4(objectMatrix),
        snapVertexId: nearestVertexId
      };
    } else {
      const intersect = this.getMouseIntersect(event);
      if (!intersect) return;

      cutPointData = {
        position: intersect.point.clone(),
        snapVertexId: null
      };
    }

    if (this.cutPoints.length === 0) {
      this.cutPoints.push(cutPointData);
      return;
    }
    this.cutPoints.push(cutPointData);

    const aCut = this.cutPoints[0];
    const bCut = this.cutPoints[1];

    this.computeNewVertices(aCut, bCut, meshData);
    // Don't apply cut when selecting on the existing polyline
    if (this.matchesExistingPolyline(meshData)) {
      this.updatePreview(aCut.position, bCut.position);
      this.cancelCut();
      return;
    }
    this.updatePreview(aCut.position, bCut.position);
    this.beforeMeshData = structuredClone(meshData);
    
    this.applyCut();

    this.afterMeshData = structuredClone(meshData);
    this.editor.execute(new KnifeCommand(this.editor, editedObject, this.beforeMeshData, this.afterMeshData));

    const mode = this.editSelection.subSelectionMode;
    if (mode === 'vertex') {
      this.editSelection.selectVertices(this.newVertices.map(v => v.id));
    } else if (mode === 'edge') {
      this.editSelection.selectEdges(this.newEdges.map(e => e.id));
    } else if (mode === 'face') {
      this.editSelection.clearSelection();
    }
    this.cancelCut();
  }

  onPointerMove(event) {
    if (!this.active) return;

    const intersect = this.getMouseIntersect(event);
    if (!intersect) return;

    const editedObject = this.editSelection.editedObject;
    const objectMatrix = editedObject.matrixWorld;
    const meshData = editedObject.userData.meshData;

    const nearestVertexId = this.editSelection.pickNearestVertexOnMouse(event, this.renderer, this.camera, 0.02);

    // No aCut selected yet → preview hover vertex
    if (this.cutPoints.length === 0) {
      
      let hoverACut;
      if (nearestVertexId !== null) {
        const v = meshData.getVertex(nearestVertexId);
        hoverACut = {
          position: new THREE.Vector3(v.position.x, v.position.y, v.position.z).applyMatrix4(objectMatrix),
          snapVertexId: nearestVertexId
        };
      } else {
        hoverACut = {
          position: null,
          snapVertexId: null
        };
      }

      this.updatePreview(hoverACut.position);
      return;
    }

    // aCut already selected → preview aCut and bCut
    const aCut = this.cutPoints[0];

    let bCut;
    if (nearestVertexId !== null) {
      const v = meshData.getVertex(nearestVertexId);
      bCut = {
        position: new THREE.Vector3(v.position.x, v.position.y, v.position.z).applyMatrix4(objectMatrix),
        snapVertexId: nearestVertexId
      };
    } else {
      bCut = {
        position: intersect.point.clone(),
        snapVertexId: null
      };
    }

    this.computeNewVertices(aCut, bCut, meshData);
    this.updatePreview(aCut.position, bCut.position);
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

  computeNewVertices(aCut, bCut, meshData) {
    this.intersections = [];
    this.edgeIntersections = [];

    const aPos = aCut.position;
    const bPos = bCut.position;

    if (aCut.snapVertexId !== null) {
      this.intersections.push(aPos.clone());
      this.edgeIntersections.push(null);
    }

    const midPoint = new THREE.Vector3().addVectors(aPos, bPos).multiplyScalar(0.5);
    const cameraPos = this.camera.position.clone();
    const cameraDir = new THREE.Vector3().subVectors(cameraPos, midPoint).normalize();
    const segmentDir = new THREE.Vector3().subVectors(bPos, aPos).normalize();

    const planeNormal = new THREE.Vector3().crossVectors(segmentDir, cameraDir).normalize();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, aPos);

    const editedObject = this.editSelection.editedObject;
    const objectMatrix = editedObject.matrixWorld;

    const skipVIdA = aCut.snapVertexId;
    const skipVIdB = bCut.snapVertexId;

    for (let edge of meshData.edges.values()) {
      // Skip edges touching snapped endpoints
      if (skipVIdA !== null && (edge.v1Id === skipVIdA || edge.v2Id === skipVIdA)) continue;
      if (skipVIdB !== null && (edge.v1Id === skipVIdB || edge.v2Id === skipVIdB)) continue;

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

      const hits = this.raycaster.intersectObject(editedObject, true);

      if (hits.length > 0 && hits[0].distance < this.raycaster.far) continue;

      if (!this.isIntersectionWithinScreenSegment(aPos, bPos, intersection, this.camera)) continue;

      this.intersections.push(intersection.clone());
      this.edgeIntersections.push(edge);
    }

    if (bCut.snapVertexId !== null) {
      this.intersections.push(bPos.clone());
      this.edgeIntersections.push(null);
    }

    this.dedupeIntersections(aPos);
  }

  applyCut() {
    if (this.intersections.length === 0) return this.cancelCut();

    const editedObject = this.editSelection.editedObject;
    if (!editedObject) return;
    const meshData = editedObject.userData.meshData;
    const worldToLocal = new THREE.Matrix4().copy(editedObject.matrixWorld).invert();

    this.newVertices = [];
    this.newEdges = [];

    for (let i = 0; i < this.edgeIntersections.length; i++) {
      const edge = this.edgeIntersections[i];
      let newVertex;

      if (edge === null) {
        const cutPointData = this.cutPoints.find(cp => cp.position.equals(this.intersections[i]));
        newVertex = meshData.getVertex(cutPointData.snapVertexId);
      } else {
        const pos = this.intersections[i];
        const localPos = pos.clone().applyMatrix4(worldToLocal);
        newVertex = meshData.addVertex({ x: localPos.x, y: localPos.y, z: localPos.z });
      }
      this.newVertices.push(newVertex);
    }

    // Collect affected faces
    const affectedFaces = new Set();
    for (let i = 0; i < this.edgeIntersections.length; i++) {
      const edge = this.edgeIntersections[i];

      if (edge) {
        // Normal edge intersection
        for (const faceId of edge.faceIds) {
          const face = meshData.faces.get(faceId);
          if (face) affectedFaces.add(face);
        }
      } else {
        // Snap vertex logic
        this.collectSnapAffectedFaces(i, affectedFaces, meshData);
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

        const intersectionIndex = this.edgeIntersections.findIndex(e => e && e.id === edge?.id);
        if (intersectionIndex !== -1) {
          cutPoints.push({ edgeIndex: i, newVertex: this.newVertices[intersectionIndex] });
        }

        const snapCut = this.cutPoints.find(cp => cp.snapVertexId === v1);
        if (snapCut) {
          cutPoints.push({ edgeIndex: i, newVertex: meshData.getVertex(v1) });
        }
      }

      if (cutPoints.length === 0) continue;

      meshData.deleteFace(face);

      // Create faces
      if (cutPoints.length === 1) {
        const { edgeIndex, newVertex } = cutPoints[0];
        const newFaceVerts = [];
        for (let i = 0; i < vertexIds.length; i++) {
          const v = meshData.getVertex(vertexIds[i]);
          newFaceVerts.push(v);

          if (i === edgeIndex && v !== newVertex) {
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

        const newEdge = meshData.getEdge(cutA.newVertex.id, cutB.newVertex.id);
        this.newEdges.push(newEdge);
      }
    }

    // Remove all intersected edges
    for (const edge of this.edgeIntersections) {
      meshData.deleteEdge(edge);
    }
  }

  cancelCut() {
    this.scene.remove(this.previewLine);
    this.scene.remove(this.previewPoints);
    this.cutPoints = [];
    this.intersections = [];
    this.edgeIntersections = [];
    this.newVertices = [];
  }

  updatePreview(aPos, bPos = null) {
    const hasA = aPos instanceof THREE.Vector3;
    const hasB = bPos instanceof THREE.Vector3;

    // --- Preview Line ---
    if (hasA && hasB) {
      const positions = [aPos.x, aPos.y, aPos.z, bPos.x, bPos.y, bPos.z];
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
    }

    // --- Preview Points ---
    if (this.previewPoints) {
      this.scene.remove(this.previewPoints);
      this.previewPoints.geometry.dispose();
      this.previewPoints.material.dispose();
    }

    const pointPositions = [];
    if (hasA && !hasB && this.intersections.length === 0) {
      if (aPos) {
        pointPositions.push(aPos.x, aPos.y, aPos.z);
      }
    } else {
      for (const v of this.intersections) {
        pointPositions.push(v.x, v.y, v.z);
      }
    }

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
    const verts = [];
    verts.push(startCut.newVertex);

    const startIndex = startCut.edgeIndex;
    const endIndex = endCut.edgeIndex;

    let i = (startIndex + 1) % vertexIds.length;
    while (i !== (endIndex + 1) % vertexIds.length) {
      const v = meshData.getVertex(vertexIds[i]);
      if (v !== startCut.newVertex && v !== endCut.newVertex) {
        verts.push(v);
      }
      i = (i + 1) % vertexIds.length;
    }

    if (verts[verts.length - 1] !== endCut.newVertex) {
      verts.push(endCut.newVertex);
    }
    return verts;
  }

  collectSnapAffectedFaces(intersectionIndex, affectedFaces, meshData) {
    const i = intersectionIndex;
    const cutPoint = this.cutPoints.find(cp => cp.position.equals(this.intersections[i]));
    if (!cutPoint || cutPoint.snapVertexId === null) return;

    const snapVertex = meshData.getVertex(cutPoint.snapVertexId);

    const prevIntersection = (i > 0) ? this.intersections[i - 1] : null;
    const nextIntersection = (i < this.intersections.length - 1) ? this.intersections[i + 1] : null;

    const prevCutPoint = prevIntersection ? this.cutPoints.find(cp => cp.position.equals(prevIntersection)) : null;
    const nextCutPoint = nextIntersection ? this.cutPoints.find(cp => cp.position.equals(nextIntersection)) : null;
    
    const prevSnapVertex =
      prevCutPoint && prevCutPoint.snapVertexId !== null
        ? meshData.getVertex(prevCutPoint.snapVertexId) : null;
    const nextSnapVertex =
      nextCutPoint && nextCutPoint.snapVertexId !== null
        ? meshData.getVertex(nextCutPoint.snapVertexId) : null;

    const sourceSnapVertex = prevSnapVertex || nextSnapVertex;

    const prevEdge = this.edgeIntersections[i - 1] || null;
    const nextEdge = this.edgeIntersections[i + 1] || null;

    const sourceEdge = prevEdge || nextEdge;

    // Use edge-based face inference
    if (sourceEdge) {
      for (const faceId of sourceEdge.faceIds) {
        if (snapVertex.faceIds.has(faceId)) {
          const face = meshData.faces.get(faceId);
          if (face) affectedFaces.add(face);
        }
      }
      return;
    }

    // No edges → pure snap-to-snap segment
    if (!sourceSnapVertex) return;

    for (const faceId of snapVertex.faceIds) {
      if (sourceSnapVertex.faceIds.has(faceId)) {
        const face = meshData.faces.get(faceId);
        if (face) affectedFaces.add(face);
      }
    }
  }

  matchesExistingPolyline(meshData) {
    const aCut = this.cutPoints[0];
    const bCut = this.cutPoints[1];

    // Early exit if both cut points are the same vertex
    if (aCut.snapVertexId !== null && bCut.snapVertexId !== null && aCut.snapVertexId === bCut.snapVertexId) {
      return true;
    }

    const editedObject = this.editSelection.editedObject;
    const invMatrix = new THREE.Matrix4().copy(editedObject.matrixWorld).invert();
    const vertexIds = [];

    for (let i = 0; i < this.intersections.length; i++) {
      const intersection = this.intersections[i];
      const localIntersection = intersection.clone().applyMatrix4(invMatrix);
      let vId = null;

      const edge = this.edgeIntersections[i];
      if (edge !== null) {
        const v1 = meshData.getVertex(edge.v1Id);
        const v2 = meshData.getVertex(edge.v2Id);
        const v1Pos = new THREE.Vector3(v1.position.x, v1.position.y, v1.position.z);
        const v2Pos = new THREE.Vector3(v2.position.x, v2.position.y, v2.position.z);

        if (localIntersection.distanceTo(v1Pos) < 1e-4) {
          vId = edge.v1Id;
        } else if (localIntersection.distanceTo(v2Pos) < 1e-4) {
          vId = edge.v2Id;
        }
      } else {
        const cutPoint = this.cutPoints.find(cp => intersection.distanceTo(cp.position) < 1e-4);
        if (cutPoint) vId = cutPoint.snapVertexId;
      }

      if (vId === null) return false;
      vertexIds.push(vId);
    }

    for (let i = 0; i < vertexIds.length - 1; i++) {
      const a = vertexIds[i];
      const b = vertexIds[i + 1];
      if (!meshData.getEdge(a, b)) return false;
    }

    return true;
  }

  dedupeIntersections(aPos, eps = 1e-4) {
    if (this.intersections.length === 0) return;

    // Pair intersections with edges to keep alignment
    const pairs = this.intersections.map((p, i) => ({
      p,
      edge: this.edgeIntersections[i]
    }));

    // Sort intersections along the cut direction using distance to aPos
    pairs.sort((a, b) =>
      a.p.distanceTo(aPos) - b.p.distanceTo(aPos)
    );

    const unique = [];

    for (const item of pairs) {
      const prev = unique[unique.length - 1];

      // Accept first, or accept if far enough from previous
      if (!prev || prev.p.distanceTo(item.p) > eps) {
        unique.push(item);
      }
    }

    // Unpack back into the class arrays
    this.intersections = unique.map(u => u.p);
    this.edgeIntersections = unique.map(u => u.edge);
  }
}