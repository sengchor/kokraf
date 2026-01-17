import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const PG_CRON_SECRET = Deno.env.get("PG_CRON_SECRET")!;

console.log("Reset Credits Function Loaded!");

Deno.serve(async (req) => {
  try {
    const secret = req.headers.get("x-cron-secret");
    if (secret !== PG_CRON_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }

    const { error } = await supabase
      .from("profiles")
      .update({ credits: 20 })
      .not("id", "is", null);;

    if (error) {
      console.error("Reset failed:", error);
      return new Response(JSON.stringify({ success: false }), { status: 500 });
    }

    console.log("Monthly credits reset to 20 for all users");
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ success: false }), { status: 500 });
  }
});