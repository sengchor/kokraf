class FloatingTooltip {
  constructor() {
    this.el = null;
    this.roots = new WeakSet();
    this.blockers = new Set();
    this.currentTarget = null;
  }

  _ensureElement() {
    if (this.el) return;

    this.el = document.createElement('div');
    this.el.className = 'floating-tooltip';
    document.body.appendChild(this.el);
  }

  addBlocker(predicate) {
    this.blockers.add(predicate);
    return () => this.blockers.delete(predicate);
  }

  _isBlocked() {
    for (const predicate of this.blockers) {
      if (predicate()) return true;
    }
    return false;
  }

  attach(root) {
    if (!root || this.roots.has(root)) return;
    this.roots.add(root);
    this._ensureElement();

    root.addEventListener('mouseover', (e) => {
      const target = e.target.closest('[data-tooltip]');
      if (!target || !root.contains(target)) return;

      if (target.classList.contains('menu-item') && target.classList.contains('active')) return;

      if (target.querySelector('select:focus')) return;

      this.show(target);
    });

    root.addEventListener('mouseout', (e) => {
      const target = e.target.closest('[data-tooltip]');
      if (!target) return;
      if (target.contains(e.relatedTarget)) return;
      this.hide();
    });

    root.addEventListener('scroll', () => this.hide());

    root.addEventListener('focusin', (e) => {
      if (e.target.tagName === 'SELECT') this.hide();
    });
  }

  show(target) {
    this._ensureElement();
    if (this._isBlocked()) return;

    const text = target.getAttribute('data-tooltip');
    if (!text) return;

    this.currentTarget = target;
    this.el.textContent = text;

    this.el.classList.add('visible');
    this.el.style.transform = 'translateX(-50%)';

    const rect = target.getBoundingClientRect();
    const top = rect.bottom + 8;
    let left = rect.left + rect.width / 2;

    const halfWidth = this.el.offsetWidth / 2;
    const margin = 4;
    left = Math.max(halfWidth + margin, Math.min(left, window.innerWidth - halfWidth - margin));

    this.el.style.top = `${top}px`;
    this.el.style.left = `${left}px`;
  }

  hide() {
    if (!this.el) return;
    this.currentTarget = null;
    this.el.classList.remove('visible');
  }

  hideFor(target) {
    if (this.currentTarget === target) this.hide();
  }
}

export const floatingTooltip = new FloatingTooltip();