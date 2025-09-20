// supabase/functions/upsert_entry/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

serve(async (req) => {
  // CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }

  try {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    // Must be JSON
    const ct = req.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      return json({ error: "Content-Type must be application/json" }, 415);
    }

    // Parse body to match frontend
    const { user_id, day, text, mood, source } = await req.json();
    if (typeof user_id !== "string" || typeof day !== "string" || typeof text !== "string") {
      return json({ error: "Missing required fields: user_id (string), day (YYYY-MM-DD as 'date'), text (string)" }, 422);
    }

    // Forward the caller's auth so RLS uses auth.uid()
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const updatedAt = new Date().toISOString();

    // Upsert by (user_id, day)
    const row = {
      user_id,
      day,
      text,
      mood,
      source,
      updated_at: updatedAt,
    };

    const { data, error } = await supabase
      .from("entries")
      .upsert([row], { onConflict: "user_id,day" })
      .select("*")
      .single();

    if (error) {
      return json({ error: error.message }, 400);
    }

    return json({ ok: true, data }, 200);
  } catch (e) {
    return json({ error: e?.message ?? "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
