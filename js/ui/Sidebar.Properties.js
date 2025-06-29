import { SidebarObject } from './Sidebar.Object.js';

export default class SidebarProperties {
  constructor(editor) {
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

      this.showActiveTab();
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
}