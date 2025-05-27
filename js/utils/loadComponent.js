export async function loadComponent(selector, url, onLoaded) {
  const container = document.querySelector(selector);
  if (!container) {
    console.warn(`No container found for selector: ${selector}`);
    return;
  }

  try {
    const response = await fetch(url);
    const html = await response.text();
    container.innerHTML = html;

    // Callback after HTML is loaded
    if (typeof onLoaded === 'function') {
      onLoaded(container);
    }
  } catch (error) {
    console.error(`Failed to load component from ${url}`, error);
  }
}

export function loadUIComponents(toolbar) {
  loadComponent('#menu-container', 'components/menu-bar.html');

  loadComponent('#right-panel-container', 'components/panel-tabs.html', () => {
    document.querySelectorAll('.tab').forEach((tab, index) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.panel-content').forEach(c => c.style.display = 'none');

        tab.classList.add('active');
        document.querySelectorAll('.panel-content')[index].style.display = 'block';
      });
    });

    document.querySelectorAll('.outliner-item').forEach(item => {
      item.addEventListener('click', () => {
        document.querySelectorAll('.outliner-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
      });
    });

    import('../panel-resizer.js').then(module => module.setupOutlinerResizer());
  });

  loadComponent('#viewport-controls-container', 'components/viewport-controls.html');
}