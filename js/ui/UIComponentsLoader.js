export default class UIComponentsLoader {
  constructor() {}

  async loadComponent(selector, url, onLoaded) {
    const container = document.querySelector(selector);
    if (!container) {
      console.warn(`No container found for selector: ${selector}`);
      return;
    }

    try {
      const response = await fetch(url);
      const html = await response.text();
      container.innerHTML = html;

      if (typeof onLoaded === 'function') {
        onLoaded(container);
      }
    } catch (error) {
      console.error(`Failed to load component from ${url}`, error);
    }
  }

  loadUIComponents(panelResizer) {
    this.loadComponent('#right-panel-container', 'components/panel-tabs.html', () => {
      // Tab switching
      document.querySelectorAll('.tab').forEach((tab, index) => {
        tab.addEventListener('click', () => {
          document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
          document.querySelectorAll('.panel-content').forEach(c => c.style.display = 'none');

          tab.classList.add('active');
          document.querySelectorAll('.panel-content')[index].style.display = 'block';
        });
      });

      // Outliner item selection
      document.querySelectorAll('.outliner-item').forEach(item => {
        item.addEventListener('click', () => {
          document.querySelectorAll('.outliner-item').forEach(i => i.classList.remove('selected'));
          item.classList.add('selected');
        });
      });

      panelResizer.initRightPanelResizer();
      panelResizer.initOutlinerResizer();
    });

    this.loadComponent('#viewport-controls-container', 'components/viewport-controls.html');
  }
}
