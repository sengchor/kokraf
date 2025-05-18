export function setupRightPanelResizer(resizeCanvas) {
  const resizer = document.getElementById('right-panel-resizer');
  const rightPanel = document.getElementById('right-panel-container');

  if (!resizer || !rightPanel) return;

  let isResizing = false;

  resizer.addEventListener('mousedown', () => {
    isResizing = true;
    document.body.classList.remove('resizing-outliner');
    document.body.classList.add('resizing-right-panel');
    document.body.style.cursor = 'col-resize';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;

    const newWidth = window.innerWidth - e.clientX;

    if (newWidth >= 325 && newWidth <= window.innerWidth - 2.5) {
      rightPanel.style.width = `${newWidth}px`;
      resizer.style.right = `${newWidth}px`;

      if (resizeCanvas) resizeCanvas();
    }
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      document.body.classList.remove('resizing-right-panel');
      document.body.style.cursor = 'default';
    }
  });
}

export function setupOutlinerResizer() {
  const resizer = document.getElementById('outliner-resizer');
  const outliner = document.getElementById('outliner-list');

  if (!resizer || !outliner) return;

  let isResizing = false;

  resizer.addEventListener('mousedown', (e) => {
    isResizing = true;
    document.body.classList.remove('resizing-right-panel');
    document.body.classList.add('resizing-outliner');
    document.body.style.cursor = 'row-resize';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const containerTop = outliner.getBoundingClientRect().top;

    const newHeight = e.clientY - containerTop - 20;

    if (newHeight >= 20 && newHeight <= window.innerHeight - containerTop - 30) {
      outliner.style.height = `${newHeight}px`;
      outliner.style.maxHeight = `${newHeight}px`;
    }
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      document.body.classList.remove('resizing-outliner');
      document.body.style.cursor = 'default';
    }
  });
}