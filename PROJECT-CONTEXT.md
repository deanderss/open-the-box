# Open the Box: Project Context for AI Assistants

Give this file to any AI that will maintain or extend the app. Read it first, then `ALL-SOURCE.md` (every file in full) and `DEPLOY.md` (hosting setup).

---

## 1. What the app is

A Jackbox-style **team video party game** for a small internal team (fewer than 20 people, 1–3 groups).

1. During the week, team members send Instagram Reels, TikToks and Facebook videos (as **links**) into a group's "box" using a mobile web form. They don't need a login.
2. At the end of a team meeting, the moderator shares their screen and clicks a cartoony box. It opens and the unplayed videos play **one at a time in random order**, with **no indication of who sent each one**.
3. Each person uses their own phone to **rate the video from 1 to 10** and **guess who sent it**.
4. The sender is **revealed once everyone has answered or after 2.5 minutes**, whichever comes first. The moderator then clicks **Next**. Videos never auto-advance.
5. A video that has played **never plays again** in a future session.
6. Each box has a **Top 100** list of its highest-rated videos (rewatchable) and an **all-time guessing leaderboard** (correct guesses).

The tone is playful and cartoony: chunky buttons, confetti, a box mascot with a face, and jokey copy.

---

## 2. Product decisions made with the owner (don't change without asking)

| Topic | Decision |
|---|---|
| Hosting | Standalone web app: **Vercel (Hobby, free) + Supabase (free)**. It must stay on free tiers, and the owner explicitly does not want it to grow into something paid. |
| Hierarchy | **Group (box) is the top level.** Log in, then **My Groups**. Pick a group (or click **+ Create Group**), then the group lobby, which leads to **Open the Box** or **Top 100** (and the **Leaderboard**). |
| Moderator access | **Login is required** (email and password). A moderator sees **only the boxes they own or co-moderate**. |
| Moderator sign-up | **Anyone can request access**, but each new moderator must be **approved by the admin** before they can log in (see section 11). Hard cap of **50 moderator accounts** (pending requests count), configurable by the admin (1–50). The only admin is `dane.andersson.da@gmail.com` (enforced in the database). |
| Co-moderators | Supported. Any moderator of a box can invite another *existing* moderator by email. Only the **owner** can delete the box or remove co-moderators. A co-moderator can remove themselves. |
| Team members | **Never log in.** Submission uses a secret per-box **share link** (`/s/<token>`). Playing uses a **4-letter room code**, then picking your name from the roster. |
| Submission | The mobile form accepts **several links at once** (up to 15). |
| Scoring | A running **leaderboard per box** of correct guesses (1 point each), all-time plus last session. |
| Reveal | The sender is **revealed after each video**, when everyone has locked in **or** after **150 seconds** (server-enforced). The moderator can also click **Reveal now**. |
| Submission form tone | A "⚠️ **These better be good…**" sticky note. After submitting, a fake "AI is watching your videos…" scan, then a **random** verdict: "The AI watched these videos… **and they ROCK!!!**", "…they're fine", or "…they STINK". Weights are 40% rock, 30% meh and 30% stink. The verdict is intentionally random and does not judge real quality. |

---

## 3. Tech stack

- **Next.js 14.2.35** (App Router, TypeScript, server components plus route handlers). Keep this on the latest 14.2.x patch for security.
- **Tailwind CSS 3.4** with a custom theme in `tailwind.config.ts`:
  - colours: `night`, `plum`, `grape`, `bubble`, `sunny`, `mint`, `tang`, `sky`, `cardboard`
  - shadows: `shadow-chunky` and `shadow-chunkySm`
  - fonts: **Fredoka** (`font-display`) and **Nunito** (`font-body`), loaded through `next/font`
- Shared component classes live in `app/globals.css`: `.btn`, `.btn-pink`, `.btn-yellow`, `.btn-mint`, `.btn-sky`, `.btn-ghost`, `.btn-danger`, `.btn-sm`, `.card`, `.input`, `.label` and `.title`.
- **framer-motion** for animation, **canvas-confetti** for confetti, **qrcode.react** for QR codes.
- **Supabase**: Postgres, Auth (email and password) and Realtime (broadcast only), through `@supabase/ssr` and `@supabase/supabase-js`.
- **Vercel Cron** (`vercel.json`) calls `/api/keepalive` daily at 12:00 UTC so the free Supabase project doesn't pause after 7 idle days.

### Environment variables
| Name | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key, used in the browser only for auth and realtime subscription |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only**; used by route handlers for all writes and public reads |
| `CRON_SECRET` | Vercel sends `Authorization: Bearer <CRON_SECRET>` to the cron route |
| `RESEND_API_KEY` | *(optional)* server only; lets the app email the admin about new moderator requests (resend.com free tier) |
| `ADMIN_NOTIFY_EMAIL` | *(optional)* who gets those emails; defaults to `dane.andersson.da@gmail.com` |
| `NOTIFY_FROM` | *(optional)* sender address; defaults to `Open the Box <onboarding@resend.dev>` |

---

## 4. Security model (important)

- **Reads by moderators** go through server components using the user's session (`supabaseServer()`), so **RLS applies**. Every table has RLS enabled. Moderators have **SELECT-only** policies scoped by `public.is_group_mod(group_id)`.
- **All writes**, and all **public** (no-login) access, go through **route handlers** using the **service-role** client (`supabaseAdmin()`), which bypasses RLS. They run **after** an explicit check:
  - `requireUser()`, `requireGroupMod(groupId)` or `requireAdmin()` in `lib/api.ts`, or
  - checking a submit token, room code or device token.
- **The service-role key must never reach the client.** Only files under `app/api/**`, `lib/supabase-server.ts`, `lib/game.ts` and server components may import `supabaseAdmin`.
- `public.is_group_mod()` is `SECURITY DEFINER` to avoid RLS recursion on `group_moderators`. Keep it that way.
- **Moderator cap**: a `BEFORE INSERT` trigger on `auth.users` (`enforce_moderator_cap`) raises `moderator_cap_reached` once `count(auth.users) >= app_settings.max_moderators`. It uses an advisory lock to avoid races.
  - The sign-up route also pre-checks `moderator_slots_remaining()`.
  - **Supabase Auth has public sign-ups disabled.** Accounts are created only by `/api/auth/signup` using `auth.admin.createUser({ email_confirm: true })`, then the browser signs in with the password.
- **Profile trigger** `handle_new_user`: inserts into `public.moderators` and sets `is_admin = true` if it's the first moderator.
- **Group trigger** `handle_new_group`: inserts the owner into `group_moderators` with role `owner`.
- **Sender anonymity** is enforced on the server. `buildState()` in `lib/game.ts` never includes `submitted_by` unless the session state is `reveal`. The exception is the sender's own device, which gets `me.isMine` so it can show the decoy screen.
  - Don't add sender info to any client payload, and don't list queued videos with senders on any moderator page. Moderators often play too.
- **Decoy answers**: the sender also "locks in" (with `is_decoy = true` and no rating or guess). That way, the answered count and avatar lights don't reveal who the sender is. Decoys are excluded from ratings, scoring and leaderboards.
- **Phone identity**: joining creates a `session_players` row with a random `device_token`, stored in the phone's localStorage as `otb-seat-<CODE>`. Answers require that token. A name already taken in a session returns 409, and the host can "kick" (free) a name from the lobby.
- **Rate limiting** (`lib/ratelimit.ts`) is **in-memory per serverless instance**, so it's best effort only:
  - sign-up: 5 per hour per IP
  - submissions: 20 per hour per IP
  - joins: 60 per hour per IP
  - state polls: 4000 per hour per IP

---

## 5. Data model (`supabase/migrations/20250101000000_init.sql`)

- `app_settings` is a **single row** (`id = 1`):
  - `max_moderators` (50)
  - `max_groups_per_moderator` (10)
  - `max_players_per_group` (30)
  - `max_queued_videos_per_group` (300)
  - `answer_window_seconds` (150)
- `moderators`: `id` (references auth.users), `display_name`, `email`, `is_admin`
- `groups`: `name`, `color`, `emoji`, `owner_id`, `submit_token` (unique, generated in app code with `crypto.randomBytes(18).toString('base64url')`)
- `group_moderators`: `group_id`, `moderator_id`, `role` (`owner` or `co`)
- `players`: the roster. `display_name` is unique per group, plus `avatar_color` and `active` (removal is a **soft delete**, so history and the leaderboard stay intact)
- `videos`:
  - `platform` (`tiktok`, `instagram` or `facebook`), `source_url` (canonical), `embed_url`
  - `status` (`queued`, `played` or `skipped`), `played_at`, `avg_rating`, `rating_count`
  - `unique(group_id, source_url)`, which is how duplicates are detected
- `sessions`:
  - `room_code` (unique among sessions where `ended_at is null`), `state` (`lobby`, `playing`, `reveal` or `finished`)
  - `video_order uuid[]` (shuffled at start), `current_index`, `video_started_at`, `reveal_at`, `ended_at`
- `session_players`: `session_id`, `player_id`, `device_token`
- `responses`: `rating` (1–10, null for decoys), `guessed_player_id`, `is_correct`, `is_decoy`; `unique(session_id, video_id, player_id)`
- View `group_leaderboard` (`security_invoker`): correct guesses and total guesses per player, decoys excluded
- RPCs: `moderator_slots_remaining()` (executable by anon), `ping()` (used by keepalive)

**Schema changes:** add a **new** migration file. Never edit the init file once deployed. Apply it by pasting into the Supabase SQL Editor (that's how the owner deploys) and copy it into the repo.

---

## 6. Game engine (`lib/game.ts`): the state machine

```
lobby --begin--> playing(index 0) --(all answered | 150s | Reveal now)--> reveal --Next--> playing(index+1) ... --> finished
                     |                                                        |
                     +--Skip (status = skipped, responses deleted)-------------+--> next index
End game at any time: finished (unplayed videos stay queued)
```

- `beginSession`: shuffles all `queued` videos for the group (Fisher–Yates using `crypto.randomBytes`) into `video_order`, then shows index 0.
- `showVideoAt`: marks the video **`played` as soon as it's shown**, so it never repeats. It sets `video_started_at` and broadcasts. Past the end, the session becomes `finished`.
- `maybeAutoReveal`: **lazy and server-authoritative**. It runs on every `/api/session/state` poll and every answer.
  - It reveals when `elapsed >= answer_window_seconds`, or when `answered >= joined`. Both counts include the sender's decoy answer.
- `doReveal`: an idempotent conditional update (`where state = 'playing' and current_index = X`) that then recalculates `videos.avg_rating` and `rating_count` from non-decoy responses.
- `buildState(session, viewer)` is the single snapshot sent to the host screen and phones. It contains:
  - session info, group, roster, joined players with `answered` flags, and counts
  - the current video
  - the reveal (only in `reveal` state), session scores and the finale data
  - `me` (for a phone with a valid device token)
- **Real-time:** clients poll `/api/session/state` (host every 2s, phones every 2s), and they also subscribe to a Supabase Realtime **broadcast** channel `session-<id>`. The server sends a payload-free "update" nudge through the Realtime REST broadcast endpoint, and clients refetch when it arrives. Polling is the source of truth.
- `/api/session/start` **reuses** an unfinished session for the group if it's less than 6 hours old. Otherwise it closes the old one and makes a new room code (24-letter alphabet without I or O).
- `getSessionByCode(code, true)` also returns sessions that **ended in the last 3 hours**, so phones and the host can show the finale.

---

## 7. Video links (`lib/embeds.ts`)

- `extractUrls(text)` pulls every URL out of pasted text and removes duplicates.
- Short links (`vm.tiktok.com`, `vt.tiktok.com`, `tiktok.com/t/…`, `fb.watch`) are **expanded on the server** by following redirects, with a 6-second timeout and a mobile user agent.
- `parseVideoUrl` turns each supported link into a canonical source URL and an embed URL:

  | Link form | Embed URL |
  |---|---|
  | TikTok `…/video/<id>` | `https://www.tiktok.com/embed/v2/<id>` |
  | Instagram `/reel`, `/reels`, `/p` or `/tv/<code>` | `https://www.instagram.com/<kind>/<code>/embed/` |
  | Facebook `/reel/<id>`, `/watch?v=`, `/<page>/videos/<id>`, `/share/r/`, `/share/v/`, `fb.watch` | `https://www.facebook.com/plugins/video.php?href=<encoded>&show_text=false&autoplay=true` |

- YouTube and other sites are rejected as `invalid`. Adding YouTube would mean a new parser branch plus a `'youtube'` value in the `videos.platform` check constraint (a new migration).
- `components/EmbedPlayer.tsx` shows a 9:16 iframe with `allow="autoplay; encrypted-media; …"`, plus an "Open on <platform>" fallback link.

---

## 8. Pages and routes

| Path | Who | File | Notes |
|---|---|---|---|
| `/` | — | `app/page.tsx` | Redirects to `/login` (middleware sends logged-in users to `/groups`) |
| `/login` | public | `app/login/page.tsx` | Log in or sign up, with seats remaining and a 🔒 lock when the cap is full |
| `/forgot`, `/reset-password`, `/auth/callback` | public | | Password reset through Supabase email |
| `/groups` | moderator | `app/groups/page.tsx`, `CreateGroup.tsx` | My Groups, showing queued counts and the create dialog |
| `/g/[groupId]` | moderator | `page.tsx`, `OpenBoxButton`, `SharePanel`, `RosterPanel`, `ModsPanel` | Lobby: box (starts a session), Top 100, Leaderboard, share link (copy, QR, regenerate), roster, co-moderators, delete box |
| `/g/[groupId]/play?session=<id>` | moderator | `play/page.tsx` | Big screen: lobby (code, QR, players, kick), playing (embed, countdown ring, answered avatars, Reveal now, Skip), reveal (drum-roll, sender, average rating, guesses, mini scores), finale |
| `/g/[groupId]/top` | moderator | `top/page.tsx`, `TopList.tsx` | Top 100 by `avg_rating` then `rating_count`, with a rewatch modal |
| `/g/[groupId]/leaderboard?view=all\|last` | moderator | `leaderboard/page.tsx` | All-time view or last session |
| `/admin` | admin | `admin/page.tsx`, `AdminPanel.tsx` | Seats used and cap, change cap, remove moderators |
| `/s/[token]` | public | `app/s/[token]/page.tsx` | Fun submission form: mascot, warning note, multi-link input, fake AI scan, random verdict, "Ask the AI again" |
| `/join?code=XXXX` | public | `app/join/page.tsx` | Phone controller: code, pick name, rate 1–10, guess, lock in, reveal result, finale |

**Middleware** (`middleware.ts`) refreshes the Supabase session cookie and protects `/groups`, `/g/*` and `/admin`. `/s/*` and `/join` are deliberately public.

**API routes** (all JSON, in `app/api/**`, wrapped in `handle()` for consistent errors):

| Area | Routes |
|---|---|
| Auth | `POST /api/auth/signup`, `GET /api/auth/slots` |
| Groups | `POST /api/groups`; `PATCH` and `DELETE /api/groups/[id]`; `POST` and `DELETE /api/groups/[id]/players`; `POST /api/groups/[id]/link`; `POST` and `DELETE /api/groups/[id]/moderators` |
| Submission (public) | `GET` and `POST /api/submit` |
| Sessions | `POST /api/session/start`; `POST /api/session/action` (`{action: begin \| reveal \| next \| skip \| end \| kick}`); `GET /api/session/state`; `POST /api/session/join`; `POST /api/session/answer` |
| Admin | `POST /api/admin/settings`, `DELETE /api/admin/moderators` |
| Cron | `GET /api/keepalive` |

**Shared components:**
- `Box.tsx`: the clickable box that opens. It wobbles, fires confetti, pops the lid, then calls `onOpened`.
- `BoxMascot.tsx`: the non-interactive mascot. Its moods are `idle`, `hungry`, `chomp`, `rock`, `meh` and `stink`.
- `Avatar`, `Countdown`, `EmbedPlayer`, `TopBar`, `LogoutButton`.
- `useGameState.ts`: polling, the realtime subscription, and the `useCountdown` hook.

---

## 9. Status, and what has NOT been verified (read this)

- The full app **compiles** (`next build` passes) and the **submission form** was visually checked in a browser using **mocked API responses**.
- The video link parser was unit-checked against sample TikTok, Instagram and Facebook links.
- **Never run against a real Supabase database.** The following are untested end to end:
  - the SQL migration itself (trigger creation on `auth.users`, RLS policies, the view)
  - sign-up, the cap trigger and admin assignment
  - the game loop, automatic reveal, scoring, the leaderboard and Top 100
  - the Realtime broadcast (the REST topic name `session-<id>` is unverified, though polling covers it)
- Facebook `share/r`, `share/v` and `fb.watch` embeds may not render, because Facebook's plugin can need the canonical URL. TikTok and Instagram embeds are standard.
- Browsers may block autoplay with sound, so the moderator may need to click play. The **Skip** button handles private or deleted posts.
- Deployment status: the owner is deploying manually by following `DEPLOY.md` (Supabase SQL Editor, GitHub upload, Vercel import). Confirm the live URL and that the Supabase Auth settings match `DEPLOY.md`:
  - sign-ups **off**
  - confirm email **off**
  - Site URL and Redirect URLs set to the Vercel domain
- **Recommended first task** for whoever picks this up: run a dry run (two players, two videos) and fix anything that breaks.

---

## 10. Working on the code

- `npm install`, then `npm run dev`, with `.env.local` containing the four environment variables. If your shell has `NODE_ENV=production` set, use `npm install --include=dev` and run `NODE_ENV=development npm run dev`, or Tailwind won't load.
- `npm run build` must pass before deploying. Vercel builds on every push to the GitHub repo.
- `deploy.sh` is an optional one-shot script that does everything through the Supabase Management API and the Vercel CLI. It needs `SB_TOKEN` and `VERCEL_TOKEN`, and runs with `PHASE=supabase|vercel|all`. It never prints secrets.
- Conventions:
  - Use Tailwind with the existing theme tokens and the `.btn`, `.card` and `.title` classes.
  - Keep the cartoony tone, with emoji in the copy.
  - Client pages are `"use client"`. Server pages use `getMe()` from `lib/me.ts`.
  - Wrap new API routes in `handle()` and use `requireGroupMod()`, `requireUser()` or `requireAdmin()`.
- Common change recipes:
  - **Answer timer**: `update app_settings set answer_window_seconds = 120;` (no code change).
  - **Moderator cap**: through the `/admin` page, or `update app_settings set max_moderators = N;`.
  - **Submission verdict text or odds**: `VERDICTS`, `TAUNTS` and `rollVerdict()` in `app/s/[token]/page.tsx`.
  - **Scoring rules**: `is_correct` is set in `app/api/session/answer/route.ts`; session scores are in `buildState`; all-time scores come from the `group_leaderboard` view.
  - **A new platform**: the parser branch in `lib/embeds.ts`, the check constraint migration, the `platformOf()` icon in the submit page, and the `PLATFORM` label map in `TopList.tsx`.
- **Free-tier guardrails to preserve:**
  - store only links, never video files
  - keep the per-group caps
  - keep the daily keepalive
  - don't add paid add-ons

---

## 11. Changes since the original handoff (Nov 2026)

Live at https://open-the-box-coral.vercel.app (Vercel team "Open the Box") on Supabase project `oqfezbyqlpbqmiqhfnji` (us-east-2). Migrations live in `supabase/migrations/` and were applied through the Supabase Management API.

| Migration | What it does |
|---|---|
| `20250101000000_init.sql` | Original schema |
| `20250101000100_grants_and_admin_lock.sql` | **Fixes "permission denied for table groups".** Tables created through the Management API had no data privileges for `service_role`, so every server write failed. Grants full access to `service_role`, SELECT-only to `authenticated` (RLS still limits rows), nothing to `anon`, plus default privileges for future tables. Also locks admin to `dane.andersson.da@gmail.com` (trigger plus `moderators_admin_email_lock` check constraint). |
| `20250101000200_moderator_approval.sql` | `moderator_requests` table (server-only), `moderators.approved`, and `handle_new_user` now creates unapproved profiles except for the admin. |
| `20250101000300_pause_and_limits.sql` | `sessions.paused_at`; defaults and live values changed to **10 boxes per moderator** and **50 moderators**. |

**Moderator approval flow**
- `POST /api/auth/signup` creates the auth user **blocked** (`ban_duration` ~100 years), inserts a `moderator_requests` row (name, email, IP, user agent) and emails the admin via `lib/notify.ts` (Resend; skipped with a log line if `RESEND_API_KEY` is unset).
- The login page shows "request sent". Blocked logins show "waiting for approval" (Supabase returns "User is banned").
- `/admin` lists pending requests with **Approve** and **Deny**, plus a history. `POST /api/admin/requests` approves (lifts the ban, sets `approved`) or denies (deletes the auth user, which frees the seat; the request row stays as history).
- Pending requests hold a seat. The admin account is never gated. The email links to `/admin` instead of one-click approve links, because email scanners can trigger GET links.
- The `Database error`/`moderator_cap_reached` trigger still enforces the cap in the database.

**Pause / resume**
- `pauseSession` and `resumeSession` in `lib/game.ts`. While paused the answer timer is frozen. On resume, `video_started_at` moves forward by the paused duration. Auto-reveal, answers and gameplay actions are blocked while paused.
- Host header has **Pause & exit**. The box lobby shows **Resume game** when an unfinished game exists. **End game** still finishes it for good.
- `/api/session/start` now reuses an unfinished session regardless of age (previously 6 hours).
- Phones show a "Game paused" panel.

**Fullscreen video (host screen)**
- While a video is `playing`, `EmbedPlayer` runs as a full-viewport CSS overlay (works on iPhone) and `play/page.tsx` also requests real browser fullscreen from the Start/Next/Resume click (Android, desktop and iPad only; browsers require a user gesture).
- It returns to the window view at the reveal, on pause, or via the **Exit** button. A **Full screen** button re-enters it.
- **Limitation:** the video plays inside TikTok/Instagram/Facebook iframes, which don't report when playback ends. "Video ended" is therefore the reveal (everyone locked in, 150 seconds, or **Reveal now**).

**Caching fix:** `lib/supabase-server.ts` passes `cache: "no-store"` to every server-side fetch. Without it, Next.js cached Supabase reads (stale seat counts and game state).

**Deploy notes:** `deploy.sh` now accepts `SB_REF` (skips the org lookup), reads `VERCEL_TOKEN` from the environment, and works with the current Vercel CLI. Secrets live only in the git-ignored `.env.local` and in Vercel; revoke deploy tokens after use. Redeploy with `npx vercel deploy --prod --scope open-the-box`.
