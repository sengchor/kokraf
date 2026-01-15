export class MenubarHelp {
  constructor(editor) {
    this.init();
  }

  init() {
      document.querySelector('.terms').addEventListener('click', () => {
      window.open('/terms', '_blank');
    });

    document.querySelector('.manual').addEventListener('click', () => {
      window.open('/manual', '_blank');
    });

    document.querySelector('.sourcecode').addEventListener('click', () => {
      window.open('https://github.com/sengchor/kokraf', '_blank');
    });

    document.querySelector('.about').addEventListener('click', () => {
      window.open('/about', '_blank');
    });

    document.querySelector('.report').addEventListener('click', () => {
      window.open('https://discord.com/invite/FEkhTyggYq', '_blank');
    });
  }
}