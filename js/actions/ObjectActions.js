import * as THREE from 'three';
import { RemoveObjectCommand } from "../commands/RemoveObjectCommand.js";
import { SetShadingCommand } from "../commands/SetShadingCommand.js";
import { JoinObjectsCommand } from '../commands/JoinObjectsCommand.js';
import { SequentialMultiCommand } from '../commands/SequentialMultiCommand.js';
import { DuplicateObjectCommand } from '../commands/DuplicateObjectCommand.js';
import { SetPositionCommand } from "../commands/SetPositionCommand.js";
import { SetOriginToGeometryCommand } from '../commands/SetOriginToGeometryCommand.js';
import { SetGeometryToOriginCommand } from '../commands/SetGeometryToOriginCommand.js';

export class ObjectActions {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.selection = editor.selection;
    this.sceneManager = editor.sceneManager;
    this.objectEditor = editor.objectEditor;

    this.setupListeners();
  }

  setupListeners() {
    this.signals.objectDeleted.add(() => this.deleteSelectedObjects());
    this.signals.objectDuplicated.add(() => this.duplicateSelectedObjects());
    this.signals.objectJoined.add(() => this.joinSelectedObjects());
    this.signals.objectSelectAll.add(() => this.objectSelectAll());
  }

  handleAction(action) {
    if (action === 'center-object') {
      this.centerSelectedObjects();
      return;
    }

    if (action === 'geometry-origin') {
      this.setGeometryToOrigin();
      return;
    }

    if (action === 'origin-geometry') {
      this.setOriginToGeometry();
      return;
    }

    if (action === 'duplicate-object') {
      this.duplicateSelectedObjects();
      return;
    }

    if (action === 'join-object') {
      this.joinSelectedObjects();
      return;
    }

    if (action === 'delete-object') {
      this.deleteSelectedObjects();
      return;
    }

    if (action === 'shade-smooth' || action === 'shade-flat' || action === 'shade-auto') {
      const objects = this.selection.selectedObjects;
      if (!objects || objects.length === 0) return;

      objects.forEach(obj => {
        if (!(obj instanceof THREE.Mesh)) return;

        const currentShading = obj.userData.shading;
        if (action === 'shade-smooth' && currentShading !== 'smooth') {
          this.editor.execute(new SetShadingCommand(this.editor, obj, 'smooth', currentShading));
        } else if (action === 'shade-flat' && currentShading !== 'flat') {
          this.editor.execute(new SetShadingCommand(this.editor, obj, 'flat', currentShading));
        } else if (action === 'shade-auto' && currentShading !== 'auto') {
          this.editor.execute(new SetShadingCommand(this.editor, obj, 'auto', currentShading));
        }
      });
      return;
    }

    console.log('Invalid action:', action);
  }

  deleteSelectedObjects() {
    const objects = this.selection.selectedObjects;
    if (!objects || objects.length === 0) return;

    const multi = new SequentialMultiCommand(this.editor, 'Delete Objects');

    for (const object of objects) {
      multi.add(() => new RemoveObjectCommand(this.editor, object));
    }

    this.editor.execute(multi);
  }

  duplicateSelectedObjects() {
    const objects = this.selection.selectedObjects;
    if (!objects || objects.length === 0) return;

    const duplicates = this.objectEditor.duplicateObjects(objects);

    this.editor.execute(new DuplicateObjectCommand(this.editor, objects, duplicates));
  }

  joinSelectedObjects() {
    const objects = this.selection.selectedObjects;
    if (!objects || objects.length < 2) return;

    const joined = this.objectEditor.joinObjects(objects);
    
    this.editor.execute(new JoinObjectsCommand(this.editor, objects, joined));
  }

  centerSelectedObjects() {
    const newPos = new THREE.Vector3(0, 0, 0);
    const objects = this.selection.selectedObjects;
    if (!objects || objects.length === 0) return;

    const oldPositions = objects.map(obj => obj.getWorldPosition(new THREE.Vector3()));
    const newPositions = objects.map(() => newPos.clone());

    this.editor.execute(new SetPositionCommand(this.editor, objects, newPositions, oldPositions));
  }

  setGeometryToOrigin() {
    const objects = this.selection.selectedObjects;
    if (!objects || objects.length === 0) return;

    const multi = new SequentialMultiCommand(this.editor, 'Origin to Geometry');

    for (const object of objects) {
      multi.add(() => new SetGeometryToOriginCommand(this.editor, object));
    }

    this.editor.execute(multi);

    this.editor.selection.select(objects);
    this.editor.toolbar.updateTools();
  }

  setOriginToGeometry() {
    const objects = this.selection.selectedObjects;
    if (!objects || objects.length === 0) return;

    const multi = new SequentialMultiCommand(this.editor, 'Origin to Geometry');

    for (const object of objects) {
      multi.add(() => new SetOriginToGeometryCommand(this.editor, object));
    }

    this.editor.execute(multi);

    this.editor.selection.select(objects);
    this.editor.toolbar.updateTools();
  }

  objectSelectAll() {
    const objects = [];

    const scene = this.sceneManager.mainScene;

    scene.traverse(child => {
      if (child !== scene) {
        objects.push(child);
      }
    });

    if (objects.length === 0) return;

    this.selection.select(objects);
    this.editor.toolbar.updateTools();
  }
}