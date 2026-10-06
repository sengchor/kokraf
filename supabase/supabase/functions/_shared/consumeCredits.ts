import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type Plan = "free" | "pro";
type CostMap = Record<Plan, number>;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, x-client-info, apikey",
  "Content-Type": "application/json",
};

function deny(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify({ allowed: false, ...body }), {
    status,
    headers: corsHeaders,
  });
}

export async function consumeCredits(req: Request, costMap: CostMap) {
  // Check for Authorization header
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return deny(401, { reason: "no_session" });
  }

  // Extract access token
  const token = authHeader.replace("Bearer ", "");

  // Verify the JWT and get user
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);

  if (authError || !user) {
    console.error("Auth error:", authError);
    return deny(401, { reason: "no_session" });
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("plan, credits, purchased_credits")
    .eq("id", user.id)
    .single();

  if (error || !profile) {
    return deny(404, { reason: "no_profile" });
  }

  const plan: Plan = profile.plan;
  const cost = costMap[plan] ?? 0;

  if (cost === 0) {
    return { ok: true, user, profile, headers: corsHeaders };
  }

  const monthly = profile.credits ?? 0;
  const purchased = profile.purchased_credits ?? 0;

  if (monthly + purchased < cost) {
    return deny(403, { reason: "no_credits", plan });
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

  if (updateError || !data || data.length === 0) {
    return deny(409, { reason: "race_condition" });
  }

  return { ok: true, user, profile, headers: corsHeaders };
}