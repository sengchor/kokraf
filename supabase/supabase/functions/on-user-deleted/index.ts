import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  const payload = await req.json();
  const userId = payload.old_record?.id;
  if (!userId) return new Response('No user id', { status: 400 });

  const { data: files, error: listError } = await supabase.storage
    .from('users')
    .list(userId);

  if (listError) return new Response(listError.message, { status: 500 });

  if (files?.length) {
    const paths = files.map(f => `${userId}/${f.name}`);
    const { error: removeError } = await supabase.storage
      .from('users')
      .remove(paths);

    if (removeError) return new Response(removeError.message, { status: 500 });
  }

  return new Response('OK', { status: 200 });
});