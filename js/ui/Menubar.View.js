export class MenubarView {
  constructor(editor) {
    this.sceneManager = editor.sceneManager;
    this.signals = editor.signals;

    this.states = {
      gridHelper: true,
      cameraHelpers: true,
      lightHelpers: true,
      skeletonHelpers: true
    };

    this.init();
  }

  init() {
    const helpers = [
      { label: 'Grid Helper', key: 'gridHelper' },
      { label: 'Camera Helpers', key: 'cameraHelpers' },
      { label: 'Light Helpers', key: 'lightHelpers' },
      { label: 'Skeleton Helpers', key: 'skeletonHelpers' }
    ];

    helpers.forEach(({ label, key }) => {
      const el = this.findHelperToggle(label);
      if (!el) return;

      el.addEventListener('click', () => {
        this.states[key] = !this.states[key];
        el.classList.toggle('checked', this.states[key]);
        this.signals.showHelpersChanged.dispatch(this.states);
      })
    });

    document.querySelector('.fullscreen').addEventListener('click', () => {
      this.toggleFullscreen();
    });
  }

  findHelperToggle(labelText) {
    const items = document.querySelectorAll('.toggle-item');
    for (const item of items) {
      const label = item.querySelector('.label');
      if (label && label.textContent.trim() === labelText) {
        return item;
      }
    }
    return null;
  }

  toggleFullscreen() {
    const elem = document.documentElement;
    if (!document.fullscreenElement) {
      if (elem.requestFullscreen) {
        elem.requestFullscreen();
      } else if (elem.webkitRequestFullscreen) {
        elem.webkitRequestFullscreen();
      } else if (elem.msRequestFullscreen) {
        elem.msRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      } else if (document.msExitFullscreen) {
        document.msExitFullscreen();
      }
    }
  }
}