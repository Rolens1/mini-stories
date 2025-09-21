Perfect — let’s update the README so it reflects **Render (web backend)** + **Expo Go for mobile** instead of EAS builds. This way it’s consistent with what you actually did for Mini-Stories and matches a school-project style.

Here’s the revised `README.md` you can drop at the root:

---

```markdown
# Mini-Stories — Next.js + Expo + Supabase + OpenAI

A cross-platform journaling app (web + mobile) where users write **one sentence a day** and later compile them into **AI-generated stories**.  
Powered by **Supabase** (Auth, DB, Storage, Edge Functions) and **OpenAI** for story generation.

Live (web): https://mini-stories.onrender.com

---

## Table of contents

- Features
- Tech stack
- Architecture
- Database schema
- Edge Functions
- Local setup
- Scripts
- Deployment (Render + Supabase + Expo Go)
- License

---

## Features

- 🔑 Authentication with Supabase Auth
- 📝 Daily entries (1 per day, mood optional)
- 📚 Compile stories (Today, last 3, last 7 days…)
- 🤖 AI story generation → Markdown
- 📂 Markdown saved in Supabase Storage (`stories-md` bucket)
- 📖 Stories viewer with Markdown rendering (web + mobile)
- ⚖️ Usage caps (max 2 compiles/day, ~15k tokens/day)
- 📱 Mobile app via Expo Go (no native build required)
- 🔄 Realtime entries update
- 🛡️ Row-level security on all tables

---

## Tech stack

**Frontend (Web):**

- Next.js 15
- Tailwind CSS
- React Markdown + remark-gfm

**Frontend (Mobile):**

- Expo / React Native
- Supabase JS client
- React Native Markdown viewer

**Backend:**

- Supabase (Postgres, Auth, Storage, Edge Functions)
- OpenAI API

**Hosting:**

- Web: Render (Next.js)
- Edge Functions + DB: Supabase
- Mobile: Expo Go (QR code, no EAS build)

---

## Architecture
```

apps/
web/ # Next.js frontend
mobile/ # Expo app
functions/
upsert_entry/ # Edge Function: save entry
compile_story/ # Edge Function: generate story
supabase/
migrations/ # SQL schema for entries + stories

````

---

## Database schema

### entries
- `id` (uuid, PK)
- `user_id` (uuid, FK → auth.users)
- `day` (date, unique per user)
- `text` (text, 3–240 chars)
- `mood` (text, optional)
- `source` (text, default `'web'`)
- `updated_at` (timestamptz)

### stories
- `id` (uuid, PK)
- `user_id` (uuid, FK → auth.users)
- `from_day` / `to_day` (date range)
- `title` (text), `style` (text), `persona` (text)
- `md_path` (text, Storage path)
- `tokens`, `cost_cents`, `status`
- `created_at`, `updated_at`
- `summary`, `cover_url`

**RLS enabled**: users can only read/write their own rows.

---

## Edge Functions

### `upsert_entry`
- Upserts today’s entry for the logged-in user.
- Handles CORS for browser/mobile calls.

### `compile_story`
- Reads entries in `[from, to]` range.
- Calls OpenAI → generates Markdown.
- Uploads to `stories-md` bucket.
- Inserts row in `stories`.
- Enforces usage caps.

---

## Local setup

### 1. Install
```bash
git clone <your-repo>
cd mini-stories
npm install
````

### 2. Env vars

**Web (`.env.local`):**

```
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
NEXT_PUBLIC_SUPABASE_PROJECT_REF=<project-ref>
```

**Mobile (`apps/mobile/.env`):**

```
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
EXPO_PUBLIC_SUPABASE_PROJECT_REF=<project-ref>
```

### 3. Start dev servers

```bash
# web
npm run dev

# mobile
cd apps/mobile
npx expo start
```

Scan the QR with Expo Go to run the mobile app.

---

## Scripts

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "next lint",
  "mobile:start": "cd apps/mobile && expo start"
}
```

---

## Deployment

**Supabase**

- Create Storage bucket `stories-md` (private).
- Apply migrations (`entries.sql`, `stories.sql`).
- Deploy functions:

  ```bash
  supabase functions deploy upsert_entry
  supabase functions deploy compile_story
  ```

**Web (Render)**

- Add env vars in Render dashboard.
- Build command: `npm install && npm run build`
- Start command: `npm run start`

**Mobile (Expo Go)**

- Run locally with:

  ```bash
  npx expo start
  ```

- Scan QR code with Expo Go app on iOS/Android.
- No EAS build required for testing.

---

## License

MIT
