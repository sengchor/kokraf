import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const PADDLE_WEBHOOK_SECRET = Deno.env.get("PADDLE_WEBHOOK_SECRET")!;

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

  // Only handle successful transactions
  if (
    payload.event_type === "transaction.completed" &&
    payload.data?.status === "completed"
  ) {
    const customData = payload.data.custom_data;
    const userId = customData?.supabase_user_id;

    if (!userId) {
      console.error("Missing supabase_user_id in custom_data");
      return new Response("Missing user ID", { status: 400 });
    }

    const lineItems = payload.data.details.line_items ?? [];

    if (lineItems.length === 0) {
      return new Response("No line items in transaction", { status: 400 });
    }

    const productName = lineItems[0].product?.name ?? "";
    const words = productName.split(" ");

    if (words.length < 2 || !words[1]) {
      console.error("Invalid product name format:", productName);
      return new Response(`Invalid product name: "${productName}"`, { status: 400 });
    }

    const plan = words[1].toLowerCase(); 

    // Mark user as Pro
    const { error } = await supabase
      .from("profiles")
      .update({
        paddle_customer_id: payload.data.customer_id ?? null,
        paddle_subscription_id: payload.data.subscription_id ?? null,
        plan: plan,
        subscription_starts_at: payload.data.billing_period.starts_at ?? null,
        subscription_ends_at: payload.data.billing_period.ends_at ?? null,
        subscription_status: 'active',
        subscription_cancels_at: null
      })
      .eq("id", userId);

    if (error) {
      console.error("Supabase update failed:", error);
      return new Response("Database error", { status: 500 });
    }

    console.log(`User ${userId} upgraded to Pro`);
  }

  return new Response("OK");
});