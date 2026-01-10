import { auth } from '/supabase/AuthService.js';
import { LoginPanel } from '../js/login/LoginPanel.js';

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
      onSuccess: (user) => {
        Paddle.Checkout.open({
          customer: { email: user.email },
          items: [{ priceId: PRODUCT_ID, quantity: 1 }],
          customData: { supabase_user_id: user.id }
        });
      }
    });

    loginPanel.open();
    return;
  }
  
  Paddle.Checkout.open({
    customer: { email: auth.user.email },
    items: [{ priceId: PRODUCT_ID, quantity: 1 }],
    customData: { supabase_user_id: auth.user.id }
  });
});