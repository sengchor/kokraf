import { supabase } from '/supabase/supabase.js';

export class AccountPanel {
  constructor({ rootSelector = 'body' } = {}) {
    this.root = document.querySelector(rootSelector);

    this.load();
  }

  load() {
    const template = `
      <div id="account-overlay" class="account-overlay hidden">
        <div class="account-panel">
          <button id="account-close" class="account-close" aria-label="Close">✕</button>

          <h3 class="account-title">Account</h3>

          <div class="account-section">
            <div class="account-label">Signed in as</div>
            <div id="account-email" class="account-email">user@email.com</div>
          </div>

          <!-- Billing summary -->
          <div class="account-billing">
            <div class="billing-item billing-credits">
              <div class="billing-value" id="account-credit">20</div>
              <div class="billing-label" id="account-usage-label">Credits remaining</div>
            </div>

            <div class="billing-row">
              <div class="billing-field">
                <div class="billing-label">Subscription plan</div>
                <div class="billing-text" id="account-plan">Free</div>
              </div>

              <div class="billing-field">
                <div class="billing-label" id="account-expiry-label">Renews on</div>
                <div class="billing-text" id="account-expiry">N/A</div>
              </div>
            </div>
          </div>

          <div class="account-actions">
            <button id="account-logout">Log Out</button>
          </div>
        </div>
      </div>
    `;

    this.root.insertAdjacentHTML('beforeend', template);

    this.overlay = document.getElementById('account-overlay');
    this.emailDisplay = document.getElementById('account-email');

    this.usageDisplay = document.getElementById('account-credit');
    this.usageLabel = document.getElementById('account-usage-label');

    this.planDisplay = document.getElementById('account-plan');

    this.expiryLabel = document.getElementById('account-expiry-label');
    this.expiryDisplay = document.getElementById('account-expiry');

    this.logoutBtn = document.getElementById('account-logout');

    document
      .getElementById('account-close')
      .addEventListener('click', () => this.close());

    this.logoutBtn.addEventListener('click', () => this.logout());
  }

  async open() {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session || !session.user) {
      this.emailDisplay.textContent = 'Not signed in';
      return;
    }

    const user = session.user;
    this.emailDisplay.textContent = user.email;

    const { data: profile, error } = await supabase
      .from('profiles')
      .select(`
        credits,
        plan,
        subscription_starts_at,
        subscription_ends_at
      `)
      .eq('id', user.id)
      .single();

    if (error) {
      console.error('Failed to load profile:', error);
      this.overlay.classList.remove('hidden');
      return;
    }

    this.renderPlan(profile);

    this.overlay.classList.remove('hidden');
  }

  close() {
    this.overlay.classList.add('hidden');
  }

  async logout() {
    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error('Logout error:', error);
      return;
    }

    this.close();
  }

  renderPlan(profile) {
    if (profile.plan === 'pro') {
      // Pro plan
      this.usageDisplay.textContent = 'Unlimited';
      this.usageLabel.textContent = 'Usage';

      this.planDisplay.textContent = 'Pro';
      this.planDisplay.classList.add('pro');

      this.expiryLabel.textContent = 'Renews on';
      this.expiryDisplay.textContent = profile.subscription_ends_at
        ? new Date(profile.subscription_ends_at).toLocaleDateString()
        : '—';
    } else {
      // Free plan
      this.usageDisplay.textContent = profile.credits ?? 'Null';
      this.usageLabel.textContent = 'Credits remaining';

      this.planDisplay.textContent = 'Free';
      this.planDisplay.classList.remove('pro');

      this.expiryLabel.textContent = 'Resets monthly';
      this.expiryDisplay.textContent = this.getFirstOfNextMonth().toLocaleDateString();
    }
  }

  getFirstOfNextMonth() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 1);
  }
}