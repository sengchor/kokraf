import * as THREE from 'three';
import { AddObjectCommand } from "../commands/AddObjectCommand.js";
import { RemoveObjectCommand } from "../commands/RemoveObjectCommand.js";
import { MultiCommand } from '../commands/MultiCommand.js';
import { SetShadingCommand } from "../commands/SetShadingCommand.js";
import { JoinObjectsCommand } from '../commands/JoinObjectsCommand.js';
import { SequentialMultiCommand } from '../commands/SequentialMultiCommand.js';

export class ObjectActions {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.selection = editor.selection;
    this.controlsManager = editor.controlsManager;
    this.sceneManager = editor.sceneManager;
    this.objectEditor = editor.objectEditor;

    this.setupListeners();
  }

  setupListeners() {
    this.signals.objectDeleted.add(() => this.deleteSelectedObjects());
    this.signals.objectFocused.add(() => this.focusSelectedObjects());
    this.signals.objectDuplicated.add(() => this.duplicateSelectedObjects());
    this.signals.objectJoined.add(() => this.joinSelectedObjects());
  }

  handleAction(action) {
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

  focusSelectedObjects() {
    const objects = this.selection.selectedObjects;
    if (!objects || objects.length === 0) return;
    this.controlsManager.focus(objects);
  }

  duplicateSelectedObjects() {
    const objects = this.selection.selectedObjects;
    if (!objects || objects.length === 0) return;

    const multi = new MultiCommand(this.editor, 'Duplicate Objects');
    const duplicates = [];

    objects.forEach(object => {
      const duplicate = this.objectEditor.duplicateObject(object);
      duplicates.push(duplicate);
      multi.add(new AddObjectCommand(this.editor, duplicate));
    });

    this.editor.execute(multi);

    this.selection.select(duplicates);
  }

  joinSelectedObjects() {
    const objects = this.selection.selectedObjects;
    if (!objects || objects.length < 2) return;

    const joined = this.objectEditor.joinObjects(objects);
    
    this.editor.execute(new JoinObjectsCommand(this.editor, objects, joined));
  }
}