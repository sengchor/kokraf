const VARIANTS = {
  free: {
    badge: 'PRO',
    title: "You've run out of credits",
    message: 'Upgrade to Pro for monthly credits, or grab a one-time credit pack to keep going.',
    cta: { label: 'View pricing', target: 'pro' },
  },
  pro: {
    badge: 'CREDITS',
    title: "You've used this month's credits",
    message: 'Top up with a credit pack to keep going. Purchased credits never expire and stack with monthly Pro credits',
    cta: { label: 'See credit packs', target: 'credits' },
  },
};

export class UpgradePanel {
  constructor({ rootSelector = 'body', signals, pricingUrl = '/pricing' } = {}) {
    this.root = document.querySelector(rootSelector);
    this.signals = signals;
    this.pricingUrl = pricingUrl;
    this.isOpen = false;

    this.onKeyDown = this.onKeyDown.bind(this);
    this.load();
  }

  load() {
    const template = `
      <div class="upgrade-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="upgrade-title">
        <div class="upgrade-panel">
          <button class="upgrade-close" aria-label="Close">✕</button>

          <div class="upgrade-badge"></div>
          <h3 id="upgrade-title" class="upgrade-title"></h3>
          <p class="upgrade-message"></p>

          <button class="upgrade-cta"></button>
          <button class="upgrade-dismiss">Maybe later</button>
        </div>
      </div>
    `;
    this.root.insertAdjacentHTML('beforeend', template);

    this.overlay = this.root.lastElementChild;
    this.badgeEl = this.overlay.querySelector('.upgrade-badge');
    this.titleEl = this.overlay.querySelector('.upgrade-title');
    this.messageEl = this.overlay.querySelector('.upgrade-message');
    this.ctaBtn = this.overlay.querySelector('.upgrade-cta');

    this.overlay.querySelector('.upgrade-close').addEventListener('click', () => this.close());
    this.overlay.querySelector('.upgrade-dismiss').addEventListener('click', () => this.close());
    this.ctaBtn.addEventListener('click', () => this.goToPricing());

    this.overlay.addEventListener('mousedown', (e) => {
      if (e.target === this.overlay) this.close();
    });
  }

  open({ plan, title, message } = {}) {
    const v = VARIANTS[plan] ?? VARIANTS.free;

    this.badgeEl.textContent = v.badge;
    this.titleEl.textContent = title ?? v.title;
    this.messageEl.textContent = message ?? v.message;
    this.ctaBtn.textContent = v.cta.label;

    this.signals?.disableKeyHandler.dispatch(true);
    this.overlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', this.onKeyDown);
    this.isOpen = true;

    this.ctaBtn.focus();
  }

  close() {
    if (!this.isOpen) return;

    this.signals?.disableKeyHandler.dispatch(false);
    this.overlay.classList.add('hidden');
    document.body.style.overflow = '';
    document.removeEventListener('keydown', this.onKeyDown);
    this.isOpen = false;
  }

  goToPricing() {
    window.open(this.pricingUrl, '_blank', 'noopener');
    this.close();
  }

  onKeyDown(e) {
    if (e.key === 'Escape') this.close();
  }
}