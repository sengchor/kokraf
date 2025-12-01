import { SidebarScene } from './Sidebar.Scene.js'
import { SidebarProject } from './Sidebar.Project.js';
import { SidebarSetting } from './Sidebar.Setting.js';

export default class Sidebar {
  constructor( editor ) {
    this.uiLoader = editor.uiLoader;
    this.panelResizer = editor.panelResizer;
    this.sidebarScene = null;
    this.sidebarProject = null;
    this.sidebarSetting = null;
    this.load(editor);
  }

  load(editor) {
    this.uiLoader.loadComponent('#right-panel-container', 'components/panel-tabs.html', () => {
      const tabs = document.querySelectorAll('.right-panel .tab');
      const panels = document.querySelectorAll('.panel-content');

      tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => {
          tabs.forEach(t => t.classList.remove('active'));
          panels.forEach(p => p.style.display = 'none');

          tab.classList.add('active');
          panels[index].style.display = 'block';

          if (index === 0 && this.sidebarScene?.sidebarProperties) {
            this.sidebarScene.sidebarProperties.showActiveTab();
          }
        });
      });

      this.sidebarScene = new SidebarScene(editor);
      this.sidebarProject = new SidebarProject(editor);
      this.sidebarSetting = new SidebarSetting(editor);

      this.panelResizer.initRightPanelResizer();
      requestAnimationFrame(() => this.panelResizer.onWindowResize());
    });
  }
}