import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type Plan = "free" | "pro";
type CostMap = Record<Plan, number>;

export async function consumeCredits(req: Request, costMap: CostMap) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Content-Type": "application/json",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

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
    .select("plan, credits, purchased_credits")
    .eq("id", user.id)
    .single();

  if (error || !profile) {
    return new Response("Profile not found", {
      status: 404,
      headers: corsHeaders,
    });
  }

  const plan: Plan = profile.plan;
  const cost = costMap[plan] ?? 0;

  if (cost === 0) {
    return {
      ok: true, user, profile, headers: corsHeaders
    };
  }

  const monthly = profile.credits ?? 0;
  const purchased = profile.purchased_credits ?? 0;

  if (monthly + purchased < cost) {
    return new Response(JSON.stringify({ allowed: false, reason: "no_credits" }), {
      status: 403,
      headers: corsHeaders,
    });
  }

  // Monthly credits first, then purchased credits for the remainder
  const fromMonthly = Math.min(cost, monthly);
  const fromPurchased = cost - fromMonthly;

  let query = supabase
    .from("profiles")
    .update({
      credits: monthly - fromMonthly,
      purchased_credits: purchased - fromPurchased,
    })
    .eq("id", user.id)
    .eq("purchased_credits", purchased);

  query = profile.credits === null
    ? query.is("credits", null)
    : query.eq("credits", profile.credits);

  const { data, error: updateError } = await query.select();

  if (!data || data.length === 0 || updateError) {
    return new Response(JSON.stringify({ allowed: false, reason: "race_condition" }), {
      status: 409,
      headers: corsHeaders,
    });
  }

  return { ok: true, user, profile, headers: corsHeaders };
}