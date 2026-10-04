import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const PADDLE_WEBHOOK_SECRET = Deno.env.get("PADDLE_WEBHOOK_SECRET")!;

const CREDIT_PACK_PRICE_ID = "pri_01m43abjm7tcd2t867vbtcx5ax";
const CREDITS_PER_PACK = 1000;

console.log("Paddle Webhook Function running...");

function parsePaddleSignature(header: string) {
  const parts = Object.fromEntries(header.split(";").map(p => p.split("=")));
  return { ts: parts.ts, h1: parts.h1 };
}

// Constant-time string comparison for security
function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

async function verifyPaddleSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string
): Promise<boolean> {
  const { ts, h1 } = parsePaddleSignature(signatureHeader);
  if (!ts || !h1) return false;

  // Optional: prevent replay attacks (5 min window)
  const timestampInt = parseInt(ts) * 1000;
  if (isNaN(timestampInt)) return false;
  const now = Date.now();
  if (Math.abs(now - timestampInt) > 5 * 60 * 1000) {
    console.warn("Webhook timestamp expired");
    return false;
  }

  const signedPayload = `${ts}:${rawBody}`;

  // HMAC-SHA256
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signedPayload)
  );

  const expected = Array.from(new Uint8Array(signatureBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  return timingSafeCompare(expected, h1);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const rawBody = await req.text();
  const signatureHeader = req.headers.get("Paddle-Signature");

  if (!signatureHeader) {
    return new Response("Missing Paddle signature", { status: 401 });
  }

  const isValid = await verifyPaddleSignature(
    rawBody,
    signatureHeader,
    PADDLE_WEBHOOK_SECRET
  );

  if (!isValid) {
    return new Response("Invalid signature", { status: 401 });
  }

  const payload = JSON.parse(rawBody);

  console.log("Valid Paddle webhook:", payload.event_type);

  // Handle successful transactions
  if (payload.event_type === "transaction.completed") {
    const response = await handleTransactionCompleted(payload, supabase);
    if (response) return response;
  }

  // Handle subscription updated
  if (payload.event_type === "subscription.updated") {
    const response = await handleSubscriptionUpdated(payload, supabase);
    if (response) return response;
  }

  return new Response("OK", { status: 200 });
});

async function handleTransactionCompleted(
  payload: any,
  supabase: SupabaseClient
): Promise<Response | null> {
  if (payload.data?.status !== "completed") {
    return null;
  }

  const customData = payload.data.custom_data;
  const userId = customData?.supabase_user_id;

  if (!userId) {
    console.error("Missing supabase_user_id in custom_data");
    return new Response("Missing user ID", { status: 400 });
  }

  // Credit pack (one-time): must run before the subscription logic
  const items = payload.data.items ?? [];
  const creditPackQty = items
    .filter((item: any) => item.price?.id === CREDIT_PACK_PRICE_ID)
    .reduce((sum: number, item: any) => sum + (item.quantity ?? 0), 0);

  if (creditPackQty > 0) {
    return await handleCreditPackPurchase(
      userId,
      creditPackQty,
      payload.data.id,
      supabase
    );
  }

  const isRecurring =
    payload.data.origin === "subscription_recurring";

  // Renewal
  if (isRecurring) {
    const { error } = await supabase
      .from("profiles")
      .update({
        subscription_status: "active",
        subscription_ends_at: payload.data.billing_period?.ends_at ?? null,
        credits: 1200
      })
      .eq("id", userId);

    if (error) {
      console.error("Renewal update failed:", error);
      return new Response("Database error", { status: 500 });
    }

    console.log(`Subscription renewed for user ${userId}`);
    return null;
  }

  // New Subscription
  const lineItems = payload.data.details?.line_items ?? [];

  if (lineItems.length === 0) {
    return new Response("No line items in transaction", { status: 400 });
  }

  const productName = lineItems[0].product?.name ?? "";
  const words = productName.split(" ");

  if (words.length < 2 || !words[1]) {
    console.error("Invalid product name format:", productName);
    return new Response(`Invalid product name: "${productName}"`, {
      status: 400
    });
  }

  const plan = words[1].toLowerCase();

  const { error } = await supabase
    .from("profiles")
    .update({
      paddle_customer_id: payload.data.customer_id ?? null,
      paddle_subscription_id: payload.data.subscription_id ?? null,
      plan: plan,
      subscription_starts_at: payload.data.billing_period?.starts_at ?? null,
      subscription_ends_at: payload.data.billing_period?.ends_at ?? null,
      subscription_status: "active",
      subscription_cancels_at: null,
      ...(plan === "pro" && { credits: 1200 })
    })
    .eq("id", userId);

  if (error) {
    console.error("Supabase update failed:", error);
    return new Response("Database error", { status: 500 });
  }

  console.log(`User ${userId} subscription activated (${plan})`);
  return null;
}

async function handleSubscriptionUpdated(
  payload: any,
  supabase: SupabaseClient
): Promise<Response | null> {
  const userId = payload.data?.custom_data?.supabase_user_id;

  if (!userId) {
    console.error("Missing supabase_user_id");
    return new Response("Missing user ID", { status: 400 });
  }

  const status = payload.data.status;
  const scheduled = payload.data.scheduled_change;

  // User canceled (but still active)
  if (status === "active" && scheduled?.action === "cancel") {
    const { error } = await supabase
      .from("profiles")
      .update({
        subscription_status: "canceled",
        subscription_cancels_at: new Date().toISOString()
      })
      .eq("id", userId);

    if (error) {
      console.error("Cancel update failed:", error);
      return new Response("Database error", { status: 500 });
    }

    console.log(`Subscription scheduled to cancel for ${userId}`);
    return null;
  }

  // Fully ended (canceled or past due)
  if (status === "canceled" || status === "past_due") {
    const { error } = await supabase
      .from("profiles")
      .update({
        plan: "free",
        subscription_status: null,
        subscription_cancels_at: null,
        paddle_subscription_id: null,
        subscription_starts_at: null,
        subscription_ends_at: null,
        credits: 20
      })
      .eq("id", userId);

    if (error) {
      console.error("End update failed:", error);
      return new Response("Database error", { status: 500 });
    }

    console.log(`Subscription ended for ${userId}`);
    return null;
  }

  // Ignore other statuses safely
  console.log(`Unhandled subscription status: ${status}`);
  return null;
}

async function handleCreditPackPurchase(
  userId: string,
  quantity: number,
  transactionId: string,
  supabase: SupabaseClient
): Promise<Response | null> {
  const credits = quantity * CREDITS_PER_PACK;

  // Retry a few times in case the balance changes between read and write
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: profile, error: readError } = await supabase
      .from("profiles")
      .select("purchased_credits")
      .eq("id", userId)
      .single();

    if (readError || !profile) {
      console.error("Failed to read profile:", readError);
      return new Response("Database error", { status: 500 });
    }

    const current = profile.purchased_credits;

    const { data: updated, error: updateError } = await supabase
      .from("profiles")
      .update({ purchased_credits: current + credits })
      .eq("id", userId)
      .eq("purchased_credits", current)
      .select("id");

    if (updateError) {
      console.error("Credit pack update failed:", updateError);
      return new Response("Database error", { status: 500 });
    }

    if (updated && updated.length > 0) {
      console.log(
        `Granted ${credits} purchased credits to ${userId} (${quantity} pack(s), ${transactionId})`
      );
      return null;
    }
  }

  console.error(`Credit pack grant conflicted repeatedly for ${userId} (${transactionId})`);
  return new Response("Conflict, please retry", { status: 500 });
}