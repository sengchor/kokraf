import SidebarProperties from './Sidebar.Properties.js';
import { MoveObjectCommand } from '../commands/MoveObjectCommand.js';

export class SidebarScene {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.panelResizer = editor.panelResizer;
    this.sidebarProperties = new SidebarProperties(editor);
    this.scene = editor.sceneManager.mainScene;
    this.selectionHelper = editor.selectionHelper;
    this.toolbar = editor.toolbar;
    this.outlinerList = document.getElementById('outliner-list')

    this.init();
    this.rebuild();
  }

  init() {
    this.outlinerList.addEventListener('click', (event) => {
      const item = event.target.closest('.outliner-item');
      if (!item) {
        this.selectionHelper.deselect();
        this.toolbar.updateTools();
        return;
      }

      this.outlinerList.querySelectorAll('.outliner-item.selected')
        .forEach(i => i.classList.remove('selected'));

      this.selectObjectFromOutlinerItem(item);
    });

    this.dragDropReordering();
    this.panelResizer.initOutlinerResizer();
    this.setupListeners();
  }

  setupListeners() {
    this.signals.objectAdded.add(() => this.rebuild());
    this.signals.objectRemoved.add(() => this.rebuild());
    this.signals.objectChanged.add(() => this.rebuild());
    this.signals.sceneGraphChanged.add(() => this.rebuild());
    this.signals.objectSelected.add((object) => this.highlightOutlinerItem(object));
  }

  rebuild() {
    this.outlinerList.innerHTML = '';

    const traverse = (object, depth = 0) => {
      if (object.name === '__VertexPoints') return;

      const li = document.createElement('li');
      li.className = 'outliner-item';
      li.dataset.uuid = object.uuid;
      li.setAttribute('draggable', 'true');

      for (let i = 0; i < depth; i++) {
        const spacer = document.createElement('span');
        spacer.className = 'space';
        li.appendChild(spacer);
      }

      li.append('• ', object.name || object.type);
      this.outlinerList.appendChild(li);

      const sortedChildren = this.sortByNameOrType(object.children);
      sortedChildren.forEach(child => traverse(child, depth + 1));
    };

    const sortedRoot = this.sortByNameOrType(this.scene.children);
    sortedRoot.forEach(child => traverse(child));
  }

  sortByNameOrType(objects) {
    return [...objects].sort((a, b) => {
      const nameA = (a.name || a.type || '').toLowerCase();
      const nameB = (b.name || b.type || '').toLowerCase();
      return nameA.localeCompare(nameB);
    });
  }

  dragDropReordering() {
    let draggedItem = null;
    let dropTarget = null;
    let nextDropTarget = null;
    let dropMode = null;

    this.outlinerList.addEventListener('dragstart', (event) => {
      const item = event.target.closest('.outliner-item');
      if (!item) return;

      document.querySelectorAll('.outliner-item').forEach(el => {
        el.classList.remove('selected', 'dragTop', 'dragBottom', 'dragInto');
      });

      draggedItem = item;
      this.selectObjectFromOutlinerItem(item);
    });


    this.outlinerList.addEventListener('dragover', (event) => {
      event.preventDefault();

      const target = event.target.closest('.outliner-item');
      if (!target) return;

      document.querySelectorAll('.outliner-item').forEach(el => {
        el.classList.remove('dragTop', 'dragBottom', 'dragInto');
      });

      const bounding = target.getBoundingClientRect();
      const offset = event.clientY - bounding.top;
      const topQuarter = bounding.height * 0.25;
      const bottomQuarter = bounding.height * 0.75;

      if (offset < topQuarter) {
        dropMode = 'before';
        target.classList.add('dragTop');
        nextDropTarget = target;
      } else if (offset > bottomQuarter) {
        dropMode = 'after';
        target.classList.add('dragBottom');
        nextDropTarget = target.nextElementSibling?.closest('.outliner-item') ?? null;
      } else {
        dropMode = 'child';
        target.classList.add('dragInto');
      }

      dropTarget = target;
    });

    this.outlinerList.addEventListener('dragend', () => {
      document.querySelectorAll('.outliner-item').forEach(el => {
        el.classList.remove('dragTop', 'dragBottom', 'dragInto');
      });
      
      if (dropTarget) {
        const dropUuid = dropTarget.dataset.uuid;
        const dragUuid = draggedItem.dataset.uuid;

        const dropObject = this.scene.getObjectByProperty('uuid', dropUuid);
        const dragObject = this.scene.getObjectByProperty('uuid', dragUuid);

        let newParent = null;

        if (dropMode === 'child') {
          if (dragObject !== dropObject && !this.isAncestor(dropObject, dragObject)) {
            newParent = dropObject;
          }
        } else if (dropMode === 'before' || dropMode === 'after') {
          if (nextDropTarget === null) {
            newParent = this.scene;
          } else {
            const nextDropUuid = nextDropTarget.dataset.uuid;
            const nextDropObject = this.scene.getObjectByProperty('uuid', nextDropUuid);

            const dropParent = nextDropObject.parent;
            if (!dropParent || dragObject === dropParent || this.isAncestor(dropParent, dragObject)) {
              return;
            }
            newParent = dropParent;
          }
        }
        if (newParent && dragObject.parent !== newParent) {
          this.editor.execute(new MoveObjectCommand(this.editor, dragObject, newParent));
        }
      }

      dropTarget = nextDropTarget = dropMode = null;
      this.selectObjectFromOutlinerItem(draggedItem);
    });
  }

  isAncestor(child, possibleAncestor) {
    let current = child.parent;
    while (current) {
      if (current === possibleAncestor) return true;
      current = current.parent;
    }
    return false;
  }

  highlightOutlinerItem(object) {
    document.querySelectorAll('.outliner-item').forEach(el => {
      el.classList.remove('selected');
    });

    if (!object) return;
    const objectItem = this.outlinerList.querySelector(`[data-uuid="${object.uuid}"]`);
    if (!objectItem) return;

    objectItem.classList.add('selected');
    objectItem.scrollIntoView({ block: 'nearest' });
  }

  selectObjectFromOutlinerItem(item) {
    if (!item) return;

    item.classList.add('selected');

    const uuid = item.dataset.uuid;
    if (!uuid) return;

    const object = this.scene.getObjectByProperty('uuid', uuid);
    if (!object) return;

    this.selectionHelper.select(object);
    this.toolbar.updateTools();
  }
}