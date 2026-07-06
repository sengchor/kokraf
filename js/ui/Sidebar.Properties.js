import { SidebarObject } from './Sidebar.Object.js';
import { SidebarMaterial } from './Sidebar.Material.js';

export default class SidebarProperties {
  constructor(editor) {
    this.signals = editor.signals;
    this.uiLoader = editor.uiLoader;
    this.viewportControls = editor.viewportControls;
    this.activeTabIndex = 0;
    this.tabs = [];
    this.panels = [];
    this.currentMode = 'object';
    this.isMeshSelected = false;
    this.ready = this.load(editor);

    this.currentMode = this.viewportControls.currentMode;
  }

  async load(editor) {
    await this.uiLoader.loadComponent('#details-panel-container', 'components/details-panel.html');

    this.tabs = document.querySelectorAll('.details-panel .tab');
    this.panels = document.querySelectorAll('.properties-content');
    this.objectTab = document.querySelector('.tab[data-tab="object"]');
    this.materialTab = document.querySelector('.tab[data-tab="material"]');
    this.objectTabIndex = Array.from(this.tabs).findIndex(t => t.dataset.tab === 'object');
    this.materialTabIndex = Array.from(this.tabs).findIndex(t => t.dataset.tab === 'material');

    this.tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => {
        this.activeTabIndex = index;
        this.showActiveTab();
      });
    });

    new SidebarObject(editor);
    new SidebarMaterial(editor);

    this.showActiveTab();
    this.applyTabState();

    this.signals.objectSelected.add(selectedObjects => {
      if (this.currentMode !== 'object') return;

      const object = selectedObjects.length === 1 ? selectedObjects[0] : null;
      this.isMeshSelected = !!(object && object.isMesh);
      this.applyTabState();
    });

    this.signals.modeChanged.add(mode => {
      this.currentMode = mode;
      this.applyTabState();
    });

    this.signals.setEditObjectPanel.add(object => {
      this.isMeshSelected = !!(object && object.isMesh);
      this.applyTabState();
    });

    this.signals.setPaintObjectPanel.add(object => {
      this.isMeshSelected = !!(object && object.isMesh);
      this.applyTabState();
    });
  }

  showActiveTab() {
    this.tabs.forEach(t => t.classList.remove('active'));
    this.panels.forEach(p => p.style.display = 'none');

    if (this.tabs[this.activeTabIndex] && this.panels[this.activeTabIndex]) {
      this.tabs[this.activeTabIndex].classList.add('active');
      this.panels[this.activeTabIndex].style.display = 'block';
    }
  }

  applyTabState() {
    if (this.currentMode === 'paint') {
      if (this.objectTab) this.objectTab.style.display = 'none';
      if (this.materialTab) this.materialTab.style.display = 'inline-block';

      if (this.materialTabIndex !== -1) this.activeTabIndex = this.materialTabIndex;

      this.showActiveTab();
      return;
    }

    if (this.currentMode === 'edit') {
      if (this.objectTab) this.objectTab.style.display = 'inline-block';
      if (this.materialTab) this.materialTab.style.display = 'none';

      if (this.objectTabIndex !== -1) this.activeTabIndex = this.objectTabIndex;

      this.showActiveTab();
      return;
    }

    // object mode
    if (this.objectTab) this.objectTab.style.display = 'inline-block';
    if (this.materialTab) this.materialTab.style.display = this.isMeshSelected ? 'inline-block' : 'none';

    if (!this.isMeshSelected && this.activeTabIndex === this.materialTabIndex) {
      this.activeTabIndex = this.objectTabIndex !== -1 ? this.objectTabIndex : 0;
    }

    this.showActiveTab();
  }
}