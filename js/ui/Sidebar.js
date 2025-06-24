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
      // Tab switching
      document.querySelectorAll('.tab').forEach((tab, index) => {
        tab.addEventListener('click', () => {
          document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
          document.querySelectorAll('.panel-content').forEach(c => c.style.display = 'none');

          tab.classList.add('active');
          document.querySelectorAll('.panel-content')[index].style.display = 'block';
        });
      });

      this.panelResizer.initRightPanelResizer();

      this.sidebarScene = new SidebarScene(editor);
      this.sidebarProject = new SidebarProject(editor);
      this.sidebarSetting = new SidebarSetting(editor);
    });
  }
}