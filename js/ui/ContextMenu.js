import * as THREE from 'three';
import { RemoveObjectCommand } from "../commands/RemoveObjectCommand.js";
import { SetShadingCommand } from "../commands/SetShadingCommand.js";

export default class ContextMenu {
  constructor( editor ) {
    this.editor = editor;
    this.uiLoader = editor.uiLoader;
    this.selection = editor.selection;
    this.menuEl = null;

    this.load();
  }

  load() {
    this.uiLoader.loadComponent('#floating-container', 'components/context-menu.html', (container) => {
      this.menuEl = container.querySelector('.context-menu');

      const appContainer = document.querySelector('.app-container');
      appContainer.addEventListener('contextmenu', (e) => {
        e.preventDefault();
      });

      const canvas = document.querySelector('#three-canvas');
      canvas.addEventListener('contextmenu', (e) => {
        if (e.button === 2) {
          e.preventDefault();
          this.show(e.clientX, e.clientY);
        }
        this.show(e.clientX, e.clientY);
      });

      appContainer.addEventListener('contextmenu', (e) => {
        if (e.target !== canvas) {
          e.preventDefault();
          this.hide();
        }
      });
      document.addEventListener('click', () => this.hide());
      document.addEventListener('mousedown', (e) => {
        if (e.button === 1) {
          this.hide();
        }
      });

      this.menuEl.querySelectorAll('[data-action]').forEach((item) => {
        item.addEventListener('click', () => {
          const action = item.getAttribute('data-action');
          this.handleAction(action);
          this.hide();
        });
      });
    });
  }

  show(x, y) {
    if (!this.menuEl) return;
    this.menuEl.style.display = 'block';
    this.menuEl.style.position = 'absolute';
    this.menuEl.style.left = `${x}px`;
    this.menuEl.style.top = `${y}px`;
  }

  hide() {
    if (this.menuEl) {
      this.menuEl.style.display = 'none';
    }
  }

  handleAction(action) {
    const objects = this.selection.selectedObjects;
    if (!objects || objects.length === 0) return;

    if (action === 'delete') {
      objects.forEach(obj => {
        this.editor.execute(new RemoveObjectCommand(this.editor, obj));
      })
      return;
    }

    if (action === 'shade-smooth' || action === 'shade-flat' || action === 'shade-auto') {
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
}