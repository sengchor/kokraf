import * as THREE from 'three';
import EditPicker from './EditPicker.js'
import {
  resolveSelectionGraphFromVertices,
  resolveSelectionGraphFromEdges,
  resolveSelectionGraphFromFaces
} from './SelectionGraph.js';

export default class EditSelection {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.keyHandler = editor.keyHandler;
    this.vertexEditor = editor.vertexEditor;

    this.editedObject = null;
    this.sceneManager = editor.sceneManager;
    this.enable = false;
    this.subSelectionMode = 'vertex';

    this.vertexHandle = new THREE.Object3D();
    this.vertexHandle.name = '__VertexHandle';
    this.vertexHandle.visible = false;
    this.sceneManager.sceneEditorHelpers.add(this.vertexHandle);

    this.camera = editor.cameraManager.camera;
    this.renderer = editor.renderer;
    this.selectionBox = editor.selectionBox;

    this.multiSelectEnabled = false;
    this.selectedVertexIds = new Set();
    this.selectedEdgeIds = new Set();
    this.selectedFaceIds = new Set();

    this.holdDelay = 500;
    this.holdMoveThreshold = 25;
    this.touchHoldTimer = null;
    this.touchHoldActive = false;
    this.touchStartClient = null;
    this.lastTouchEndTime = 0;

    this.picker = new EditPicker(editor);
    this.setupListeners();
  }

  get selectionState() {
    return {
      selectedVertexIds: this.selectedVertexIds,
      selectedEdgeIds: this.selectedEdgeIds,
      selectedFaceIds: this.selectedFaceIds
    };
  }

  get meshData() {
    return this.editedObject?.userData.meshData ?? null;
  }

  setupListeners() {
    this.signals.viewportCameraChanged.add((camera) => {
      if (camera.isDefault) {
        this.camera = camera;
      }
    });

    this.signals.multiSelectChanged.add((shiftChanged) => {
      this.multiSelectEnabled = shiftChanged;
    });

    this.signals.emptyScene.add(() => {
      this.editedObject = null;
    });

    this.signals.transformDragStarted.add((mode) => {
      if (mode !== 'edit') return;
      this.enable = false;
    });

    this.signals.transformDragEnded.add((mode) => {
      if (mode !== 'edit') return;
      this.enable = true;
    });

    this.signals.editSelectionRefresh.add(() => {
      this.signals.refreshEditHelpers.dispatch(this.editedObject, this.subSelectionMode, this.selectionState);
    });

    this.signals.editSelectAll.add(() => {
      this.selectAll();
    });

    this.signals.editSelectNone.add(() => {
      this.clearSelection();
    });

    this.signals.editSelectLinked.add(() => {
      this.selectLinked();
    });

    this.signals.mouseSelectLinked.add(() => {
      this.mouseSelectLinked();
    });

    this.signals.editSelectRings.add(() => {
      this.selectRings();
    });

    this.signals.editSelectLoops.add(() => {
      this.selectLoops();
    });

    this.signals.uvSelectionChanged.add((uvSelection) => {
      this.applyUVSelection(uvSelection);
    });

    const dom = this.renderer.domElement;
    dom.addEventListener("mousedown", this.onMouseDown.bind(this));
    dom.addEventListener("mousemove", this.onMouseMove.bind(this));
    dom.addEventListener("mouseup", this.onMouseUp.bind(this));

    dom.addEventListener("touchstart", this.onTouchStart.bind(this), { passive: false });
    dom.addEventListener("touchmove", this.onTouchMove.bind(this), { passive: false });
    dom.addEventListener("touchend", this.onTouchEnd.bind(this));
    dom.addEventListener("touchcancel", this.onTouchCancel.bind(this));
  }

  setSubSelectionMode(mode) {
    this.subSelectionMode = mode;

    if (this.subSelectionMode === 'vertex') {
      const { edgeSet, faceSet } = resolveSelectionGraphFromVertices(this.meshData, this.selectedVertexIds);
      this.selectedEdgeIds = edgeSet;
      this.selectedFaceIds = faceSet;
    } else if (this.subSelectionMode === 'edge') {
      const { vertexSet, faceSet } = resolveSelectionGraphFromEdges(this.meshData, this.selectedEdgeIds);
      this.selectedVertexIds = vertexSet;
      this.selectedFaceIds = faceSet;
    } else if (this.subSelectionMode === 'face') {
      const { vertexSet, edgeSet } = resolveSelectionGraphFromFaces(this.meshData, this.selectedFaceIds);
      this.selectedVertexIds = vertexSet;
      this.selectedEdgeIds = edgeSet;
    }
  }

  applyClickSelection(event) {
    if (!this.enable) return;
    const isAlt = event.altKey;

    if (isAlt) {
      const nearestEdgeId = this.picker.pickNearestEdgeOnMouse(event, this.camera);
      this.mouseSelectLoops(nearestEdgeId);
      return;
    }

    if (this.subSelectionMode === 'vertex') {
      const nearestVertexId = this.picker.pickNearestVertexOnMouse(event, this.camera);
      if (nearestVertexId === null) {
        if (!this.multiSelectEnabled) {
          this.clearSelection();
        }
        return;
      }

      this.selectVertices(nearestVertexId);
    } else if (this.subSelectionMode === 'edge') {
      const nearestEdgeId = this.picker.pickNearestEdgeOnMouse(event, this.camera);
      if (nearestEdgeId === null) {
        if (!this.multiSelectEnabled) {
          this.clearSelection();
        }
        return;
      }

      this.selectEdges(nearestEdgeId);
    } else if (this.subSelectionMode === 'face') {
      const nearestFaceId = this.picker.pickNearestFaceOnMouse(event, this.camera);
      if (nearestFaceId === null) {
        if (!this.multiSelectEnabled) {
          this.clearSelection();
        }
        return;
      }

      this.selectFaces(nearestFaceId);
    }
  }

  applyBoxSelection() {
    if (!this.enable) return;

    if (this.subSelectionMode === 'vertex') {
      const vertexIndices = this.picker.getBoxSelectedVertexIds(this.camera);
      if (vertexIndices === null) {
        if (!this.multiSelectEnabled) {
          this.clearSelection();
        }
        return;
      }

      this.selectVertices(vertexIndices, true);
    } else if (this.subSelectionMode === 'edge') {
      const edgeIndices = this.picker.getBoxSelectedEdgeIds(this.camera);
      if (edgeIndices === null) {
        if (!this.multiSelectEnabled) {
          this.clearSelection();
        }
        return;
      }

      this.selectEdges(edgeIndices, true);
    } else if (this.subSelectionMode === 'face') {
      const faceIndices = this.picker.getBoxSelectedFaceIds(this.camera);
      if (faceIndices === null) {
        if (!this.multiSelectEnabled) {
          this.clearSelection();
        }
        return;
      }

      this.selectFaces(faceIndices, true);
    }
  }

  onMouseDown(event) {
    if (!this.enable || event.button !== 0) return;
    if (Date.now() - this.lastTouchEndTime < 600) return;
    if (!this.keyHandler.startInteraction('select')) return;

    this.vertexEditor.setObject(this.editedObject);

    this.dragging = false;
    this.mouseDownPos = { x: event.clientX, y: event.clientY };
  }

  onMouseMove(event) {
    this.lastMouseEvent = event;

    if (!this.enable || !this.mouseDownPos) return;
    if (this.keyHandler.activeInteraction !== 'select') return;

    const dx = event.clientX - this.mouseDownPos.x;
    const dy = event.clientY - this.mouseDownPos.y;
    const dragThreshold = 5;

    if (!this.dragging && Math.hypot(dx, dy) > dragThreshold) {
      this.dragging = true;
      this.selectionBox.startSelection(event.clientX, event.clientY);
    }

    if (this.dragging) {
      this.selectionBox.updateSelection(event.clientX, event.clientY);
    }
  }

  onMouseUp(event) {
    if (!this.enable || event.button !== 0) return;
    this.keyHandler.endInteraction('select');
    
    this.selectionBox.finishSelection();

    if (this.dragging) {
      this.applyBoxSelection();
    } else {
      this.applyClickSelection(event);
    }

    this.dragging = false;
    this.mouseDownPos = null;
  }

  // Touch handlers
  onTouchStart(event) {
    if (!this.enable) return;

    if (event.touches.length !== 1) {
      this.cancelTouchHold();
      return;
    }

    const touch = event.touches[0];
    this.touchStartClient = { x: touch.clientX, y: touch.clientY };
    this.touchHoldActive = false;
    this.dragging = false;


    clearTimeout(this.touchHoldTimer);
    this.touchHoldTimer = setTimeout(() => {
      this.activateTouchHold();
    }, this.holdDelay);
  }

  activateTouchHold() {
    if (!this.enable || !this.touchStartClient) return;

    const current = this.keyHandler.activeInteraction;
    if (current && current !== 'box-select') {
      this.keyHandler.endInteraction(current);
    }
    this.keyHandler.startInteraction('box-select');

    this.touchHoldActive = true;
    this.mouseDownPos = { x: this.touchStartClient.x, y: this.touchStartClient.y };
  }

  onTouchMove(event) {
    if (!this.enable || !this.touchStartClient) return;

    if (event.touches.length !== 1) {
      this.cancelTouchHold();
      return;
    }

    const touch = event.touches[0];
    const dx = touch.clientX - this.touchStartClient.x;
    const dy = touch.clientY - this.touchStartClient.y;

    if (!this.touchHoldActive) {
      if (Math.hypot(dx, dy) > this.holdMoveThreshold) {
        this.cancelTouchHold();
      }
      return;
    }

    event.preventDefault();

    const dragThreshold = 5;
    if (!this.dragging && Math.hypot(dx, dy) > dragThreshold) {
      this.dragging = true;
      this.selectionBox.startSelection(this.mouseDownPos.x, this.mouseDownPos.y);
    }

    if (this.dragging) {
      this.selectionBox.updateSelection(touch.clientX, touch.clientY);
    }
  }

  onTouchEnd(event) {
    this.lastTouchEndTime = Date.now();

    clearTimeout(this.touchHoldTimer);
    this.touchHoldTimer = null;

    if (!this.touchStartClient) return;

    if (this.touchHoldActive) {
      this.keyHandler.endInteraction('box-select');
      this.selectionBox.finishSelection();
    }

    const touch = event.changedTouches[0];

    if (this.dragging) {
      this.applyBoxSelection();
    } else {
      this.applyClickSelection({
        clientX: touch.clientX,
        clientY: touch.clientY,
        altKey: false
      });
    }

    this.resetTouchState();
  }

  onTouchCancel() {
    this.lastTouchEndTime = Date.now();
    this.cancelTouchHold();
  }

  cancelTouchHold() {
    clearTimeout(this.touchHoldTimer);
    this.touchHoldTimer = null;
 
    if (this.touchHoldActive) {
      this.keyHandler.endInteraction('box-select');
      this.selectionBox.finishSelection();
    }
 
    this.resetTouchState();
  }

  resetTouchState() {
    this.touchHoldActive = false;
    this.touchStartClient = null;
    this.dragging = false;
    this.mouseDownPos = null;
  }

  selectVertices(vertexIds, isBoxSelection = false) {
    const isArray = Array.isArray(vertexIds);
    if (!isArray) vertexIds = [vertexIds];

    if (this.multiSelectEnabled) {
      if (isBoxSelection) {
        // Box selection: add only
        vertexIds.forEach(id => this.selectedVertexIds.add(id));
      } else {
        // Click selection: toggle
        vertexIds.forEach(id => {
          if (this.selectedVertexIds.has(id)) {
            this.selectedVertexIds.delete(id);
          } else {
            this.selectedVertexIds.add(id);
          }
        });
      }
    } else {
      this.selectedVertexIds.clear();
      vertexIds.forEach(id => this.selectedVertexIds.add(id));
    }

    const { edgeSet, faceSet } = resolveSelectionGraphFromVertices(this.meshData, this.selectedVertexIds);
    this.selectedEdgeIds = edgeSet;
    this.selectedFaceIds = faceSet;

    this.updateVertexHandle();
    this.signals.editSelectionChanged.dispatch(this.selectionState);
  }

  selectEdges(edgeIds, isBoxSelection = false) {
    const isArray = Array.isArray(edgeIds);
    if (!isArray) edgeIds = [edgeIds];

    if (this.multiSelectEnabled) {
      if (isBoxSelection) {
        // Box selection: add only
        edgeIds.forEach(id => this.selectedEdgeIds.add(id));
      } else {
        // Click selection: toggle
        edgeIds.forEach(id => {
          if (this.selectedEdgeIds.has(id)) {
            this.selectedEdgeIds.delete(id);
          } else {
            this.selectedEdgeIds.add(id);
          }
        });
      }
    } else {
      this.selectedEdgeIds.clear();
      edgeIds.forEach(id => this.selectedEdgeIds.add(id));
    }

    const { vertexSet, faceSet } = resolveSelectionGraphFromEdges(this.meshData, this.selectedEdgeIds);
    this.selectedVertexIds = vertexSet;
    this.selectedFaceIds = faceSet;

    this.updateVertexHandle();
    this.signals.editSelectionChanged.dispatch(this.selectionState);
  }

  selectFaces(faceIds, isBoxSelection = false) {
    const isArray = Array.isArray(faceIds);
    if (!isArray) faceIds = [faceIds];

    if (this.multiSelectEnabled) {
      if (isBoxSelection) {
        // Box selection: add only
        faceIds.forEach(id => this.selectedFaceIds.add(id));
      } else {
        // Click selection: toggle
        faceIds.forEach(id => {
          if (this.selectedFaceIds.has(id)) {
            this.selectedFaceIds.delete(id);
          } else {
            this.selectedFaceIds.add(id);
          }
        });
      }
    } else {
      this.selectedFaceIds.clear();
      faceIds.forEach(id => this.selectedFaceIds.add(id));
    }

    const { vertexSet, edgeSet } = resolveSelectionGraphFromFaces(this.meshData, this.selectedFaceIds);
    this.selectedVertexIds = vertexSet;
    this.selectedEdgeIds = edgeSet;

    this.updateVertexHandle();
    this.signals.editSelectionChanged.dispatch(this.selectionState);
  }

  clearSelection() {
    this.selectedVertexIds.clear();
    this.selectedEdgeIds.clear();
    this.selectedFaceIds.clear();
    this.vertexHandle.visible = false;
    this.dragging = false;
    this.mouseDownPos = null;

    this.signals.editSelectionCleared.dispatch();
  }

  updateVertexHandle() {
    if (!this.vertexHandle || !this.editedObject) return;

    const meshData = this.editedObject.userData.meshData;
    if (!meshData) return;

    const vertexIds = [...this.selectedVertexIds];

    if (vertexIds.length === 0) {
      this.vertexHandle.visible = false;
      return;
    }

    const worldPos = new THREE.Vector3();
    const sum = new THREE.Vector3();
    const localPos = new THREE.Vector3();

    for (const id of vertexIds) {
      const v = meshData.getVertex(id);
      if (!v) continue;

      localPos.set(v.position.x, v.position.y, v.position.z);
      worldPos.copy(localPos).applyMatrix4(this.editedObject.matrixWorld);

      sum.add(worldPos);
    }
    sum.divideScalar(vertexIds.length);

    this.vertexHandle.position.copy(sum);
    this.vertexHandle.visible = true;
  }

  selectAll() {
    if (!this.editedObject) return;

    const meshData = this.editedObject.userData.meshData;
    if (!meshData) return;

    const mode = this.subSelectionMode;

    if (mode === 'vertex') {
      const allVertexIds = Array.from(meshData.vertices.keys());
      this.selectVertices(allVertexIds);
    }

    else if (mode === 'edge') {
      const allEdgeIds = Array.from(meshData.edges.keys());
      this.selectEdges(allEdgeIds);
    }

    else if (mode === 'face') {
      const allFaceIds = Array.from(meshData.faces.keys());
      this.selectFaces(allFaceIds);
    }
  }

  selectLinked() {
    if (!this.editedObject) return;

    const meshData = this.editedObject.userData.meshData;
    if (!meshData) return;

    const linkedVertexIds = this.vertexEditor.selection.selectVertexLinked(meshData, this.selectedVertexIds);
    this.selectVertices(Array.from(linkedVertexIds));
  }

  mouseSelectLinked() {
    if (!this.editedObject || !this.lastMouseEvent) return;

    const meshData = this.editedObject.userData.meshData;
    if (!meshData) return;

    const previousVertexIds = new Set(this.selectedVertexIds);

    this.applyClickSelection(this.lastMouseEvent);
    const linkedVertexIds = this.vertexEditor.selection.selectVertexLinked(meshData, this.selectedVertexIds);
    const currentVertexIds = this.selectedVertexIds.union(previousVertexIds)
    
    const allVertexIds = linkedVertexIds.union(currentVertexIds);
    this.selectVertices(Array.from(allVertexIds));
  }

  selectRings() {
    if (!this.editedObject) return;

    const meshData = this.editedObject.userData.meshData;
    if (!meshData) return;

    const ringEdges = this.vertexEditor.selection.selectEdgeRings(meshData, this.selectedEdgeIds);

    if (this.subSelectionMode === 'vertex') {
      const ringVertices = new Set();
      for (const edgeId of ringEdges) {
        const edge = meshData.edges.get(edgeId);
        if (!edge) continue;

        ringVertices.add(edge.v1Id);
        ringVertices.add(edge.v2Id);
      }

      this.selectVertices(Array.from(ringVertices));
    } else {
      this.selectEdges(Array.from(ringEdges));
    }
  }

  selectLoops() {
    if (!this.editedObject) return;

    const meshData = this.editedObject.userData.meshData;
    if (!meshData) return;

    const loopEdges = this.vertexEditor.selection.selectEdgeLoops(meshData, this.selectedEdgeIds);

    if (this.subSelectionMode === 'vertex') {
      const loopVertices = new Set();
      for (const edgeId of loopEdges) {
        const edge = meshData.edges.get(edgeId);
        if (!edge) continue;

        loopVertices.add(edge.v1Id);
        loopVertices.add(edge.v2Id);
      }

      this.selectVertices(Array.from(loopVertices));
    } else {
      this.selectEdges(Array.from(loopEdges));
    }
  }

  mouseSelectLoops(edgeId) {
    if (!this.editedObject) return;

    const meshData = this.editedObject.userData.meshData;
    if (!meshData) return;

    const nearestEdgeId = new Set();
    nearestEdgeId.add(edgeId);

    const isIncluded = this.selectedEdgeIds.has(edgeId);
    if (this.subSelectionMode === 'vertex') {
      const previousVertexIds = new Set(this.selectedVertexIds);
      const loopEdges = this.vertexEditor.selection.selectEdgeLoops(meshData, nearestEdgeId);

      const loopVertices = new Set();
      for (const edgeId of loopEdges) {
        const edge = meshData.edges.get(edgeId);
        if (!edge) continue;

        loopVertices.add(edge.v1Id);
        loopVertices.add(edge.v2Id);
      }

      if (this.multiSelectEnabled) {
        let allVertexIds;
        if (isIncluded) {
          allVertexIds = previousVertexIds.difference(loopVertices);
        } else {
          allVertexIds = previousVertexIds.union(loopVertices);
        }

        this.clearSelection();

        this.selectVertices(Array.from(allVertexIds));
      } else {
        this.selectVertices(Array.from(loopVertices));
      }
    }

    if (this.subSelectionMode === 'edge') {
      const previousEdgeIds = new Set(this.selectedEdgeIds);
      const loopEdges = this.vertexEditor.selection.selectEdgeLoops(meshData, nearestEdgeId);

      if (this.multiSelectEnabled) {
        let allEdgeIds;
        if (isIncluded) {
          allEdgeIds = previousEdgeIds.difference(loopEdges);
        } else {
          allEdgeIds = previousEdgeIds.union(loopEdges);
        }

        this.clearSelection();

        this.selectEdges(Array.from(allEdgeIds));
      } else {
        this.selectEdges(Array.from(loopEdges));
      }
    }

    if (this.subSelectionMode === 'face') {
      const previousFaceIds = new Set(this.selectedFaceIds);
      const loopFaces = this.vertexEditor.selection.selectFaceLoops(meshData, nearestEdgeId);

      if (this.multiSelectEnabled) {
        let allFaceIds;
        if (isIncluded) {
          allFaceIds = previousFaceIds.difference(loopFaces);
        } else {
          allFaceIds = previousFaceIds.union(loopFaces);
        }

        this.clearSelection();

        this.selectFaces(Array.from(allFaceIds));
      } else {
        this.selectFaces(Array.from(loopFaces));
      }
    }
  }

  applyUVSelection(uvSelection) {
    if (!this.editedObject) return;

    const { vertexIds, edgeIds, faceIds } = uvSelection.toMeshSelection();

    const previousMulti = this.multiSelectEnabled;
    this.multiSelectEnabled = false;
    try {
      if (this.subSelectionMode === 'vertex') this.selectVertices([...vertexIds]);
      else if (this.subSelectionMode === 'edge') this.selectEdges([...edgeIds]);
      else this.selectFaces([...faceIds]);
    } finally {
      this.multiSelectEnabled = previousMulti;
    }
  }
}