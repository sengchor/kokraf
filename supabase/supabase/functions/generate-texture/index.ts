import "@supabase/functions-js/edge-runtime.d.ts";
import { consumeCredits } from "../_shared/consumeCredits.ts";

const COST_MAP: Record<number, { free: number; pro: number }> = {
  512:  { free: 20, pro: 20 },
  1024: { free: 30, pro: 30 },
  2048: { free: 40, pro: 40 },
};

const RESOLUTION_INPUT: Record<number, string> = {
  512: "1K",
  1024: "2K",
  2048: "4K",
};

const REPLICATE_API_TOKEN = Deno.env.get("REPLICATE_API_TOKEN");

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

  try {
    const { prompt, image_input, resolution } = await req.json();

    if (!prompt || !Array.isArray(image_input) || image_input.length === 0) {
      return new Response(
        JSON.stringify({ error: "prompt and image_input (array of URLs) are required" }),
        { status: 400, headers: corsHeaders }
      );
    }

    const cost = COST_MAP[resolution] ?? COST_MAP[512];
    const result = await consumeCredits(req, cost);
    if (result instanceof Response) return result;

    const resolution_input = RESOLUTION_INPUT[resolution] ?? "1K";

    // Create prediction
    const createRes = await fetch("https://api.replicate.com/v1/models/google/nano-banana-2/predictions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json",
        "Prefer": "wait", // wait up to 60s for result inline
      },
      body: JSON.stringify({
        input: { prompt, image_input, resolution: resolution_input },
      }),
    });

    if (!createRes.ok) {
      const err = await createRes.json().catch(() => ({}));
      return new Response(
        JSON.stringify({ error: err.detail ?? createRes.statusText }),
        { status: createRes.status, headers: corsHeaders }
      );
    }

    let prediction = await createRes.json();

    // Poll if not completed yet
    while (prediction.status !== "succeeded" && prediction.status !== "failed" && prediction.status !== "canceled") {
      await new Promise((r) => setTimeout(r, 1000));

      const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
        headers: { "Authorization": `Bearer ${REPLICATE_API_TOKEN}` },
      });

      if (!pollRes.ok) {
        const err = await pollRes.json().catch(() => ({}));
        return new Response(
          JSON.stringify({ error: err.detail ?? pollRes.statusText }),
          { status: pollRes.status, headers: corsHeaders }
        );
      }

      prediction = await pollRes.json();
    }

    if (prediction.status !== "succeeded") {
      return new Response(
        JSON.stringify({ error: prediction.error ?? "Prediction failed" }),
        { status: 500, headers: corsHeaders }
      );
    }

    // output is a FileOutput — Replicate returns a URL string for image models
    return new Response(
      JSON.stringify({ url: prediction.output }),
      { headers: corsHeaders }
    );

  } catch (e) {
    return new Response(
      JSON.stringify({ 
        error: e instanceof Error ? e.message : String(e)
      }),
      { status: 500, headers: corsHeaders }
    );
  }
});