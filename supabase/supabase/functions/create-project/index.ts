import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { consumeCredits } from "../_shared/consumeCredits.ts";

const COST = { free: 10, pro: 10 };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, x-client-info, apikey",
    "Content-Type": "application/json",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const result = await consumeCredits(req, COST);
  if (result instanceof Response) return result;

  const { projectId, name, isPublic } = await req.json();

  const { data, error } = await supabase
    .from('projects')
    .insert({ id: projectId, user_id: result.user.id, name, is_public: isPublic })
    .select()
    .single();

  if (error) return new Response(JSON.stringify({ error: error.message }), {
    status: 500, headers: corsHeaders
  });

  return new Response(JSON.stringify(data), { status: 200, headers: corsHeaders });
});