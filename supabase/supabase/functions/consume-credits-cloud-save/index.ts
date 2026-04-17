import "@supabase/functions-js/edge-runtime.d.ts";
import { consumeCredits } from "../_shared/consumeCredits.ts";

const COST = {
  free: 3,
  pro: 3,
};

Deno.serve(async (req) => {
  const result = await consumeCredits(req, COST);

  if (result instanceof Response) {
    return result;
  }

  return new Response(JSON.stringify({ allowed: true }), {
    status: 200,
    headers: result.headers,
  });
});