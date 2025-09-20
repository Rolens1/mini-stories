// supabase/functions/create_story/index.ts
// Deno Edge Function — generate a story from daily entries and save it

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---------- Config ----------
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Table that holds daily entries (choose one):
// - "one_liners" with columns: date_key (date), content (text)
// - "entries"    with columns: day (date),       text    (text)
const ENTRIES_TABLE = Deno.env.get("SUPA_ENTRIES_TABLE") ?? "one_liners";

// Storage bucket to upload the generated markdown
const STORIES_BUCKET = Deno.env.get("SUPA_STORIES_BUCKET") ?? "stories-md";

// OpenAI model (you can override in project secrets)
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";

// ---------- Utils ----------
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

async function sha256Hex(input: string) {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function isISODate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// ---------- Handler ----------
serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Required envs
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return json({ error: "Missing Supabase envs" }, 500);
  if (!OPENAI_API_KEY) return json({ error: "Missing OPENAI_API_KEY" }, 500);

  try {
    // Forward caller's JWT so RLS applies
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify user
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) return json({ error: "Unauthorized" }, 401);

    // Parse input
    const payload = await req.json().catch(() => ({}));
    const from = payload?.from;
    const to = payload?.to;
    const style = payload?.style ?? "Cozy";
    const persona = payload?.persona ?? null;
    const titleOverride = payload?.title ?? null;

    if (!isISODate(from) || !isISODate(to)) {
      return json({ error: "Bad range: 'from' and 'to' must be YYYY-MM-DD" }, 400);
    }

    // Load entries
    let notesList: Array<{ date: string; text: string }> = [];

    if (ENTRIES_TABLE === "one_liners") {
      const { data, error } = await supabase
        .from("one_liners")
        .select("date_key, content")
        .gte("date_key", from)
        .lte("date_key", to)
        .order("date_key", { ascending: true });

      if (error) return json({ error: `Fetch one_liners failed: ${error.message}` }, 500);
      if (!data?.length) return json({ error: "No entries in range" }, 422);

      notesList = data.map((r: any) => ({ date: r.date_key, text: (r.content ?? "").toString().trim() }));
    } else {
      const { data, error } = await supabase
        .from(ENTRIES_TABLE)
        .select("day, text")
        .eq("user_id", user.id) // if your table stores user_id explicitly
        .gte("day", from)
        .lte("day", to)
        .order("day", { ascending: true });

      if (error) return json({ error: `Fetch ${ENTRIES_TABLE} failed: ${error.message}` }, 500);
      if (!data?.length) return json({ error: "No entries in range" }, 422);

      notesList = data.map((r: any) => ({ date: r.day, text: (r.text ?? "").toString().trim() }));
    }

    const bulletList = notesList.map(n => `- (${n.date}) ${n.text}`).join("\n");

    // Build prompt
    const system = `You are a literary editor. Style: ${style}. Persona: ${persona ?? "none"}.
Output Markdown strictly with:
# Title
## Blurb
## Chapters (3–5), each 4–6 sentences
## Closing line echoing the first entry.`;

    const userMsg = `Date range: ${from} – ${to}
Daily notes:
${bulletList}

Constraints: 600–900 words, PG-13 tone, cohesive narrative.`;

    // OpenAI via fetch (SDK-free, no .create issues)
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.5,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userMsg },
        ],
      }),
    });

    if (!r.ok) {
      const errText = await r.text();
      return json({ error: `OpenAI ${r.status}: ${errText}` }, 502);
    }

    const data = await r.json();
    const markdown: string | undefined = data?.choices?.[0]?.message?.content?.trim?.();
    if (!markdown) return json({ error: "Empty generation" }, 502);

    const titleMatch = markdown.match(/^#\s*(.+)$/m);
    const title = (titleOverride ?? (titleMatch?.[1] ?? "Untitled")).slice(0, 180);

    // Token usage (best-effort; schema may differ per model)
    const tokens: number = Number(data?.usage?.total_tokens ?? 0);
    const cost_cents = Math.max(0, Math.ceil(tokens * 0.01)); // adjust with your own pricing model

    // Upload markdown to Storage
    const storyId = crypto.randomUUID();
    const mdPath = `${user.id}/${storyId}.md`;
    const upload = await supabase.storage
      .from(STORIES_BUCKET)
      .upload(mdPath, new Blob([markdown], { type: "text/markdown" }), { upsert: true });

    if (upload.error) return json({ error: `Upload failed: ${upload.error.message}` }, 500);

    // Insert story metadata
    const insertPayload: Record<string, unknown> = {
      id: storyId,
      user_id: user.id,
      from_day: from,
      to_day: to,
      title,
      style,
      persona,
      md_path: mdPath,
      content_hash: await sha256Hex(markdown),
      tokens,
      cost_cents,
      status: "ready",
    };

    const ins = await supabase.from("stories").insert(insertPayload);
    if (ins.error && ins.error.code !== "23505") {
      return json({ error: `Insert story failed: ${ins.error.message}` }, 500);
    }

    return json({ ok: true, id: storyId, title, md_path: mdPath });
  } catch (e: any) {
    return json({ error: e?.message ?? "Unknown error" }, 500);
  }
});
