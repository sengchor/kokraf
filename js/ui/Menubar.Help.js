export class MenubarHelp {
  constructor(editor) {
    this.init();
  }

  init() {
    document.querySelector('.sourcecode').addEventListener('click', () => {
      window.open('https://github.com/sengchor/kokraf', '_blank');
    });

    document.querySelector('.about').addEventListener('click', () => {
      window.open('https://www.youtube.com/@jourverse', '_blank');
    });

    document.querySelector('.report').addEventListener('click', () => {
      window.open('https://discord.com/invite/FEkhTyggYq', '_blank');
    });

    document.querySelector('.patreon').addEventListener('click', () => {
      window.open('https://www.patreon.com/c/jourverse', '_blank');
    });
  }
}