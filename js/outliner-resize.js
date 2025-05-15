export function setupOutlinerResizer(resizeCanvas) {
  const resizer = document.getElementById('outliner-resizer');
  const outliner = document.getElementById('outliner-container');

  if (!resizer || !outliner) return;

  let isResizing = false;

  resizer.addEventListener('mousedown', () => {
    isResizing = true;
    document.body.classList.add('resizing');
    document.body.style.cursor = 'col-resize';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;

    const newWidth = window.innerWidth - e.clientX;

    if (newWidth >= 325 && newWidth <= window.innerWidth - 2.5) {
      outliner.style.width = `${newWidth}px`;
      resizer.style.right = `${newWidth}px`;

      if (resizeCanvas) resizeCanvas();
    }
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      document.body.classList.remove('resizing');
      document.body.style.cursor = 'default';
    }
  });
}