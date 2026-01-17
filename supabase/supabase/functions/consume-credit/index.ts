import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

console.log("Function file has been loaded!");

Deno.serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Content-Type": "application/json",
  };

  // Handle preflight OPTIONS request
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("Request received");

    // Check for Authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders },
      });
    }

    // Extract access token
    const token = authHeader.replace("Bearer ", "");
    
    // Verify the JWT and get user
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      console.error("Auth error:", authError);
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders },
      });
    }

    const { data: profile, error } = await supabase
      .from("profiles")
      .select("plan, credits")
      .eq("id", user.id)
      .single();

    if (error || !profile) {
      return new Response("Profile not found", {
        status: 404,
        headers: corsHeaders,
      });
    }

    // Pro = unlimited
    if (profile.plan !== "free") {
      return new Response(JSON.stringify({ allowed: true }), {
        status: 200,
        headers: corsHeaders,
      });
    }

    if (profile.credits <= 0) {
      return new Response(JSON.stringify({ allowed: false, reason: "no_credits" }), {
        status: 403,
        headers: corsHeaders,
      });
    }

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ credits: profile.credits - 1 })
      .eq("id", user.id)
      .eq("credits", profile.credits);

    if (updateError) {
      return new Response("Failed to consume credit", {
        status: 500,
        headers: corsHeaders,
      });
    }

    return new Response(JSON.stringify({ allowed: true }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { ...corsHeaders },
    });
  }
});