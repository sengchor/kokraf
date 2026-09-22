import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { KnifeOps } from '../operations/KnifeOps.js';
import { GPUEdgePicker } from '../utils/GPUEdgePicker.js';
import { worldToScreen } from '../utils/ScreenUtils.js';

const DRAG_THRESHOLD_SQ = 16; // px²
const VERTEX_SNAP_THRESHOLD = 0.05;

export class KnifeTool {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;

    this.camera = editor.cameraManager.camera;
    this.renderer = editor.renderer;
    this.sceneManager = editor.sceneManager;
    this.scene = editor.sceneManager.sceneEditorHelpers;
    this.vertexEditor = editor.vertexEditor;
    this.editSelection = editor.editSelection;

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.ops = new KnifeOps(editor);

    this.active = false;
    this.cutPoints = []; // [a] while placing, [a, b] when cutting
    this.plan = null;    // latest cut plan, drives the preview points

    this.isDragging = false;
    this.middleButton = false;
    this.dragStart = new THREE.Vector2();

    this._rafPending = false;
    this._pendingMoveEvent = null;

    this.createPreview();
    this.edgePicker = new GPUEdgePicker(this.editor);

    this.setupListeners();

    this._onPointerDown = this.onPointerDown.bind(this);
    this._onPointerMove = this.onPointerMove.bind(this);
    this._onPointerUp = this.onPointerUp.bind(this);
    this._onKeyDown = this.onKeyDown.bind(this);
  }

  enable() {
    if (this.active) return;
    this.active = true;
    this.cutPoints = [];
    this.plan = null;

    this.renderer.domElement.addEventListener('pointerdown', this._onPointerDown);
    this.renderer.domElement.addEventListener('pointermove', this._onPointerMove);
    this.renderer.domElement.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('keydown', this._onKeyDown);

    const edgeHelper = this.sceneManager.sceneHelpers.getObjectByName('__EdgeLinesVisual');
    this.edgePicker.buildFromHelper(edgeHelper);
    this.edgePicker.buildFromObject(this.editSelection.editedObject);
  }

  disable() {
    if (!this.active) return;
    this.active = false;
    this.cancelCut();
  }

  setupListeners() {
    this.signals.viewportCameraChanged.add((camera) => {
      if (camera.isDefault) {
        this.camera = camera;
        this.raycaster.camera = camera;
      }
    });

    this.signals.viewportResized.add((width, height) => {
      this.edgePicker.resize(width, height);
    });
  }

  // Cut
  executeCut() {
    const object = this.editSelection.editedObject;
    if (!object) return this.cancelCut();

    const [aCut, bCut] = this.cutPoints;
    this.plan = this.computePlan(aCut, bCut);

    // Don't cut when the stroke only retraces existing geometry
    if (!KnifeOps.matchesExistingPolyline(object.userData.meshData, object.matrixWorld, this.plan)) {
      this.ops.cut(object, this.plan);
    }

    this.cancelCut();
  }

  computePlan(aCut, bCut) {
    const object = this.editSelection.editedObject;

    const aScreen = worldToScreen(aCut.position, this.camera, this.renderer.renderer);
    const bScreen = worldToScreen(bCut.position, this.camera, this.renderer.renderer);
    const candidateEdgeIds = this.edgePicker.pickSegment(aScreen.x, aScreen.y, bScreen.x, bScreen.y, this.camera);

    return KnifeOps.computeCutPlan(
      object.userData.meshData,
      object.matrixWorld,
      this.camera,
      aCut,
      bCut,
      candidateEdgeIds
    );
  }

  cancelCut() {
    this.previewLine.visible = false;
    this.previewPoints.visible = false;
    this.cutPoints = [];
    this.plan = null;
    this.edgePicker.dispose();
  }

  // Pointer input
  onPointerDown(event) {
    if (event.button === 1) {
      this.middleButton = true;
      this.previewLine.visible = false;
      return;
    }

    if (event.button !== 0 || !this.active) return;

    const object = this.editSelection.editedObject;
    if (!object) return;

    this.dragStart.set(event.clientX, event.clientY);
    this.isDragging = true;

    this.signals.transformDragStarted.dispatch('edit');
    this.vertexEditor.setObject(object);

    const cutPoint = this.pickCutPoint(event);
    if (!cutPoint) return;

    this.cutPoints.push(cutPoint);
    if (this.cutPoints.length === 2) this.executeCut();
  }

  onPointerMove(event) {
    if (this.middleButton || !this.active) return;

    this._pendingMoveEvent = event;
    if (this._rafPending) return;

    this._rafPending = true;
    requestAnimationFrame(() => {
      this._rafPending = false;
      const e = this._pendingMoveEvent;
      this._pendingMoveEvent = null;
      if (e) this.processMoveEvent(e);
    });
  }

  processMoveEvent(event) {
    if (!this.editSelection.editedObject) return;

    // No first point yet → preview the hovered vertex only
    if (this.cutPoints.length === 0) {
      const hover = this.pickCutPoint(event, { allowSurface: false });
      this.updatePreview(hover?.position ?? null);
      return;
    }

    // First point placed → preview the cut to the cursor
    const aCut = this.cutPoints[0];
    const bCut = this.pickCutPoint(event);
    if (!bCut) return;

    this.plan = this.computePlan(aCut, bCut);
    this.updatePreview(aCut.position, bCut.position);
  }

  onPointerUp(event) {
    if (this.middleButton) this.edgePicker.dirty = true;
    this.middleButton = false;

    if (!this.active) return;

    try {
      // Click-drag-release cuts from the press point to the release point
      if (this.isDragging && this.cutPoints.length === 1) {
        const dx = event.clientX - this.dragStart.x;
        const dy = event.clientY - this.dragStart.y;

        if (dx * dx + dy * dy > DRAG_THRESHOLD_SQ) {
          const bCut = this.pickCutPoint(event);
          if (bCut) {
            this.cutPoints.push(bCut);
            this.executeCut();
          }
        }
      }
    } finally {
      this.isDragging = false;

      if (this.cutPoints.length === 0) {
        requestAnimationFrame(() => {
          this.signals.onToolEnded.dispatch();
          this.signals.transformDragEnded.dispatch('edit');
        });
      }
    }
  }

  onKeyDown(event) {
    if (!this.active) return;

    if (event.key === 'Escape') {
      this.cancelCut();
      this.signals.onToolEnded.dispatch();
      this.signals.transformDragEnded.dispatch('edit');
    }
  }

  // Picking
  // Nearest vertex under the cursor, else (optionally) the surface / fallback point.
  pickCutPoint(event, { allowSurface = true } = {}) {
    const object = this.editSelection.editedObject;
    if (!object) return null;

    const meshData = object.userData.meshData;
    const nearestVertexId = this.editSelection.pickNearestVertexOnMouse(
      event, this.renderer, this.camera, VERTEX_SNAP_THRESHOLD
    );

    if (nearestVertexId !== null) {
      const v = meshData.getVertex(nearestVertexId);
      return {
        position: new THREE.Vector3().copy(v.position).applyMatrix4(object.matrixWorld),
        snapVertexId: nearestVertexId,
      };
    }

    if (!allowSurface) return null;

    const hit = this.getMouseIntersect(event);
    return hit ? { position: hit.point.clone(), snapVertexId: null } : null;
  }

  getMouseIntersect(event) {
    const object = this.editSelection.editedObject;
    if (!object) return null;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    const intersects = this.raycaster.intersectObject(object, false);
    if (intersects.length > 0) return intersects[0];

    // No hit → point along the ray at the object's distance
    const ray = this.raycaster.ray;
    const objectWorldPos = object.getWorldPosition(new THREE.Vector3());
    const distance = ray.origin.distanceTo(objectWorldPos);

    return {
      point: ray.origin.clone().addScaledVector(ray.direction, distance),
      distance,
      object: null,
      face: null,
      isFallback: true,
    };
  }

  // Preview
  createPreview() {
    this.lineMaterial = new LineMaterial({
      color: 0xffff00,
      linewidth: 1.0,
      dashed: false,
      worldUnits: false,
      depthTest: false,
    });

    this.pointMaterial = new THREE.PointsMaterial({
      color: 0xffff00,
      size: 6,
      sizeAttenuation: false,
      depthTest: false,
      transparent: true,
      opacity: 0.8,
    });

    this.previewLineGeometry = new LineGeometry();
    this.previewLine = new Line2(this.previewLineGeometry, this.lineMaterial);
    this.previewLine.visible = false;
    this.scene.add(this.previewLine);

    this.previewPointGeometry = new THREE.BufferGeometry();
    this.previewPoints = new THREE.Points(this.previewPointGeometry, this.pointMaterial);
    this.previewPoints.visible = false;
    this.scene.add(this.previewPoints);
  }

  updatePreview(aPos, bPos = null) {
    const hasA = aPos instanceof THREE.Vector3;
    const hasB = bPos instanceof THREE.Vector3;
    const planPoints = this.plan?.points ?? [];

    // Line
    if (hasA && hasB) {
      this.previewLineGeometry.setPositions([aPos.x, aPos.y, aPos.z, bPos.x, bPos.y, bPos.z]);
      this.previewLine.computeLineDistances();
      this.previewLine.visible = true;
    } else {
      this.previewLine.visible = false;
    }

    // Points: the hovered vertex before the first click, the cut intersections after
    const pointPositions = [];
    if (hasA && !hasB && planPoints.length === 0) {
      pointPositions.push(aPos.x, aPos.y, aPos.z);
    } else {
      for (const { position } of planPoints) {
        pointPositions.push(position.x, position.y, position.z);
      }
    }

    if (pointPositions.length > 0) {
      this.previewPointGeometry.setAttribute('position', new THREE.Float32BufferAttribute(pointPositions, 3));
      this.previewPointGeometry.computeBoundingSphere();
      this.previewPoints.visible = true;
    } else {
      this.previewPoints.visible = false;
    }
  }
}