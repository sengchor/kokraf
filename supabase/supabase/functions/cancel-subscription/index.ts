import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PADDLE_SUBSCRIPTION_API_KEY = Deno.env.get("PADDLE_SUBSCRIPTION_API_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

console.log("Function file has been loaded!");

Deno.serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Content-Type": "application/json",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    console.log("Request received");

    // Check for Authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response("Unauthorized", { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      console.error("Auth error:", authError);
      return new Response("Invalid token", { status: 401 });
    }

    // Get user subscription
    const { data: profile, error } = await supabase
      .from("profiles")
      .select(
        "paddle_subscription_id, subscription_status, subscription_ends_at"
      )
      .eq("id", user.id)
      .single();

    if (error || !profile?.paddle_subscription_id) {
      return new Response(
        JSON.stringify({ error: "No active subscription "}),
        { status: 400, headers: corsHeaders }
      );
    }

    if (profile.subscription_status !== "active") {
      return new Response(
        JSON.stringify({ error: "Already canceled" }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Cancel subscription in Paddle (cancel at period end)
    const paddleRes = await fetch(
      `https://sandbox-api.paddle.com/subscriptions/${profile.paddle_subscription_id}/cancel`,
      {
        method: 'POST',
        headers: {
          "Authorization": `Bearer ${PADDLE_SUBSCRIPTION_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          effective_from: "next_billing_period" 
        })
      }
    );

    const paddleJson = await paddleRes.json();

    // Paddle cancel request
    if (!paddleRes.ok) {
      if (paddleJson?.error?.code === "subscription_locked_pending_changes") {
        return new Response(
          JSON.stringify({ success: true, alreadyCanceled: true }),
          { headers: corsHeaders }
        );
      }

      return new Response(
        JSON.stringify({ error: "Failed to cancel subscription" }),
        { status: 500, headers: corsHeaders }
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: corsHeaders }
    );
  } catch (err) {
    console.error(err);
    return new Response(
      JSON.stringify({ error: "Internal Server Error" }),
      { status: 500, headers: corsHeaders }
    );
  }
});