import { auth } from '/supabase/services/AuthService.js';
import { LoginPanel } from '../js/panels/LoginPanel.js';
import { supabase } from '/supabase/supabase.js';

const VENDOR_ID = 278565;
const PRO_PRICE_ID = "pri_01keg7mbr5a1yd033qfsmef85x";
const CREDIT_PACK_PRICE_ID = "pri_01m43abjm7tcd2t867vbtcx5ax";

const MAX_PACKS = 20;

Paddle.Setup({ vendor: VENDOR_ID });

const freeBtn = document.getElementById("free-btn");
const proBtn = document.getElementById("pro-btn");
const topupBtn = document.getElementById("topup-btn");
const packMinus = document.getElementById("pack-minus");
const packPlus = document.getElementById("pack-plus");
const packCount = document.getElementById("pack-count");

function requireLogin(action) {
  if (!auth.isLoggedIn()) {
    const loginPanel = new LoginPanel({
      onSuccess: (user) => action(user)
    });
    loginPanel.open();
    return;
  }
  action(auth.user);
}

// Free → signup
freeBtn.addEventListener("click", () => {
  requireLogin(() => {
    window.location.href = "/";
  });
});

// Pro → open Paddle checkout
proBtn.addEventListener("click", () => requireLogin(attemptProPurchase));

async function attemptProPurchase(user) {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('plan')
    .eq('id', user.id)
    .single();

  if (error) {
    console.error('Failed to fetch user plan:', error);
    return;
  }

  if (profile.plan === 'pro') {
    alert('You are already on the Pro plan!');
    return;
  }

  Paddle.Checkout.open({
    customer: { email: user.email },
    items: [{ priceId: PRO_PRICE_ID, quantity: 1 }],
    customData: { supabase_user_id: user.id }
  });
}

let packQty = 1;

function renderPack() {
  packCount.textContent = packQty;
  packMinus.disabled = packQty <= 1;
  packPlus.disabled = packQty >= MAX_PACKS;
}

packMinus.addEventListener("click", () => {
  packQty = Math.max(1, packQty - 1);
  renderPack();
});

packPlus.addEventListener("click", () => {
  packQty = Math.min(MAX_PACKS, packQty + 1);
  renderPack();
});

renderPack();

// Credit pack → open Paddle checkout
topupBtn.addEventListener("click", () => requireLogin(attemptCreditPurchase));

function attemptCreditPurchase(user) {
  Paddle.Checkout.open({
    customer: { email: user.email },
    items: [{ priceId: CREDIT_PACK_PRICE_ID, quantity: packQty }],
    customData: { supabase_user_id: user.id, type: "credit_pack" }
  });
}