import { SidebarScene } from './Sidebar.Scene.js'
import { SidebarProject } from './Sidebar.Project.js';
import { SidebarSetting } from './Sidebar.Setting.js';
import { AgentPanel } from '../panels/AgentPanel.js';
import { CommandRegistry } from '../agent/CommandRegistry.js';
import { registerAgentCommands } from '../agent/AgentCommands.js';

export default class Sidebar {
  constructor( editor ) {
    this.editor = editor;
    this.signals = editor.signals;
    this.uiLoader = editor.uiLoader;
    this.panelResizer = editor.panelResizer;
    this.sidebarScene = null;
    this.sidebarProject = null;
    this.sidebarSetting = null;
    this.ready = this.load(editor);
  }

  async load(editor) {
    await this.uiLoader.loadComponent('#right-panel-container', 'components/panel-tabs.html');

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

    this.agent = registerAgentCommands(new CommandRegistry(this.editor));

    this.agentPanel = new AgentPanel({
      registry: this.agent,
      signals: this.signals,
      container: document.getElementById('agent-tab'),
      tab: document.querySelector('.right-panel .tab[data-tab="agent"]'),
    });

    this.panelResizer.initRightPanelResizer();
    requestAnimationFrame(() => this.panelResizer.onWindowResize());
  }
}