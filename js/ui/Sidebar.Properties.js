import { SidebarObject } from './Sidebar.Object.js';
import { SidebarMaterial } from './Sidebar.Material.js';

export default class SidebarProperties {
  constructor(editor) {
    this.signals = editor.signals;
    this.uiLoader = editor.uiLoader;
    this.activeTabIndex = 0;
    this.tabs = [];
    this.panels = [];
    this.load(editor);
  }

  load(editor) {
    this.uiLoader.loadComponent('#details-panel-container', 'components/details-panel.html', () => {
      this.tabs = document.querySelectorAll('.details-panel .tab');
      this.panels = document.querySelectorAll('.properties-content');

      this.tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => {
          this.activeTabIndex = index;
          this.showActiveTab();
        });
      });

      new SidebarObject(editor);
      new SidebarMaterial(editor);

      this.showActiveTab();
      this.updateTabVisibility();
    });

    this.signals.objectSelected.add(object => {
      this.updateTabVisibility(object);
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

  updateTabVisibility(object) {
    this.objectTab = document.querySelector('.tab[data-tab="object"]');
    this.materialTab = document.querySelector('.tab[data-tab="material"]');

    const isMesh = !!(object && object.isMesh);

    if (this.materialTab) this.materialTab.style.display = isMesh ? 'inline-block' : 'none';

    if (!object || (!isMesh && this.activeTabIndex === 1)) {
      this.activeTabIndex = 0;
      this.showActiveTab();
    }
  }
}