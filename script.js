window.addEventListener('load', function() {
    const viewport = new Viewport("center-panel");
    const engine = new NodeEngine("#node-editor-canvas", viewport);

    const resizer = document.getElementById('resizer');
    const nodeEditorPanel = document.getElementById('node-editor-panel');
    let isResizing = false;

    resizer.addEventListener('mousedown', function(e) {
        isResizing = true;
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    function onMouseMove(e) {
        if (!isResizing) return;
        const newHeight = window.innerHeight - e.clientY;
        if (newHeight > 50 && newHeight < window.innerHeight - 100) {
            nodeEditorPanel.style.height = newHeight + 'px';
        }
    }

    function onMouseUp(e) {
        isResizing = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    }
});
