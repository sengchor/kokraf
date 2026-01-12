import { auth } from '/supabase/AuthService.js';
import { LoginPanel } from '../js/login/LoginPanel.js';
import { supabase } from '/supabase/supabase.js';

const VENDOR_ID = 45202;
const PRODUCT_ID = "pri_01kegge02m5bwcd311ja0ezfxr";

Paddle.Setup({ vendor: VENDOR_ID });

const freeBtn = document.getElementById("free-btn");
const proBtn = document.getElementById("pro-btn");

// Free → signup
freeBtn.addEventListener("click", () => {
  if (!auth.isLoggedIn()) {
    const loginPanel = new LoginPanel({
      onSuccess: () => {
        window.location.href = "/";
      }
    });

    loginPanel.open();
    return;
  }

  window.location.href = "/";
});

// Pro → open Paddle checkout
proBtn.addEventListener('click', async () => {
  if (!auth.isLoggedIn()) {
    const loginPanel = new LoginPanel({
      onSuccess: (user) => attemptProPurchase(user)
    });

    loginPanel.open();
    return;
  }
  
  attemptProPurchase(auth.user);
});

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
    items: [{ priceId: PRODUCT_ID, quantity: 1 }],
    customData: { supabase_user_id: user.id }
  });
}