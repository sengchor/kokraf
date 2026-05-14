import "@supabase/functions-js/edge-runtime.d.ts";

const STABILITY_AI_API_KEY = Deno.env.get('STABILITY_AI_API_KEY');

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

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const { imageBase64, prompt, negativePrompt, imageStrength, steps, cfgScale } = await req.json();

  const binary = atob(imageBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const form = new FormData();
  form.append('init_image', new Blob([bytes], { type: 'image/png' }), 'render.png');
  form.append('init_image_mode', 'IMAGE_STRENGTH');
  form.append('image_strength', String(imageStrength ?? 0.2));
  form.append('text_prompts[0][text]', prompt);
  form.append('text_prompts[0][weight]', '1');
  if (negativePrompt) {
    form.append('text_prompts[1][text]', negativePrompt);
    form.append('text_prompts[1][weight]', '-1');
  }
  form.append('cfg_scale', String(cfgScale ?? 7));
  form.append('steps', String(steps ?? 50));
  form.append('samples', '1');

  const res = await fetch(
    'https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/image-to-image',
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${STABILITY_AI_API_KEY}`, 'Accept': 'application/json' },
      body: form,
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return new Response(JSON.stringify({ error: err.message ?? res.statusText }), {
      status: res.status,
      headers: corsHeaders,
    });
  }

  const { artifacts } = await res.json();
  return new Response(
    JSON.stringify({ artifacts }), 
    { headers: corsHeaders }
  );
});