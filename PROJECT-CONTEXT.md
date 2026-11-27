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
| Reveal | The sender is **revealed after each video**, when everyone has locked in **or** after **5 minutes / 300 seconds** (server-enforced). The moderator can also click **Reveal now**. |
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
  - `answer_window_seconds` (300)
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
lobby --begin--> playing(index 0) --(all answered | 300s | Reveal now)--> reveal --Next--> playing(index+1) ... --> finished
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
  | TikTok `…/video/<id>`, `/photo/<id>`, `/embed/v2/<id>`, `m.tiktok.com/v/<id>.html` (short links `vm.`/`vt.`/`/t/` are expanded first) | `https://www.tiktok.com/embed/v2/<id>` |
  | Instagram `/reel`, `/reels`, `/p` or `/tv/<code>`, also `/<user>/reel/<code>`, `instagr.am`; **`/share/…`, `/share/reel/…`, `/share/p/…` are expanded first** (the share token is not the shortcode; an unexpanded share link is rejected, never guessed) | `https://www.instagram.com/<kind>/<code>/embed/` |
  | Facebook `/reel/<id>`, `/watch?v=`, `/video.php?v=`, `/<page>/videos/<id>`, `/share/r/`, `/share/v/` (expanded first), `fb.watch` (Facebook's own player resolves these itself) | `https://www.facebook.com/plugins/video.php?href=<encoded>&show_text=false&autoplay=true` |

- **YouTube Shorts** (`youtube.com/shorts/<11-char id>`, any `www`/`m` host, query strings ignored) embed as `https://www.youtube.com/embed/<id>?autoplay=1&playsinline=1&rel=0&modestbranding=1&loop=1&playlist=<id>`. Regular YouTube watch links and `youtu.be` links are rejected on purpose. Other sites are rejected as `invalid`.
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
- `Avatar`, `Countdown`, `EmbedPlayer` (memoized — see section 12), `TopBar`, `LogoutButton`.
- `useGameState.ts`: polling and the realtime subscription. Returns `{ state, error, refresh, fetchedAt, reconnecting }`. The old `useCountdown` export is gone — see `LiveCountdown`/`TimerBar` in section 12.
- `useSeat.ts`: the "claim a seat in this room code" lifecycle (restore from `localStorage`, `pick`, `clear`, `submitAnswer`), shared by `app/join/page.tsx`'s `Controller` and `HostPlayerPanel`.
- `components/host/*`: `HostHeader`, `LobbyView`, `StageView`, `RevealPanel`, `MiniScores`, `Finale` — the host screen's views, split out of `play/page.tsx` (see section 12).
- `lib/fullscreen.ts`: `enterNativeFullscreen`/`exitNativeFullscreen`/`scrollToTop` helpers used by the host screen.
- `lib/confetti.ts`: lazy-loading wrapper around `canvas-confetti` (`fireConfetti`, `confettiShape`) — every call site imports this instead of `canvas-confetti` directly, so the library is code-split into its own chunk.
- `components/Providers.tsx`: wraps the app in framer-motion's `MotionConfig reducedMotion="user"`, rendered from `app/layout.tsx`.
- `components/LiveCountdown.tsx`, `components/TimerBar.tsx`: leaf components that own their own 250ms ticker internally, given just `{ remainingMs, fetchedAt, ... }`. Use these (not a parent-level `setInterval`) for anything that needs to visibly count down — see section 12.
- `components/useWakeLock.ts`: wraps `navigator.wakeLock` (Screen Wake Lock API), re-acquiring on `visibilitychange`.

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
  - **Answer timer**: `update app_settings set answer_window_seconds = 300;` (no code change).
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
| `20250101000400_youtube_and_suspend.sql` | Allows `'youtube'` in the `videos.platform` check; adds `moderators.suspended`. |
| `20250101000800_submitter_half_point.sql` | `group_leaderboard` gains `submitted` (videos of theirs that were shown in a game they were in) and `points` (`correct + 0.5 * submitted`). See "Faster rounds" below. |

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
- **Limitation:** the video plays inside TikTok/Instagram/Facebook iframes, which don't report when playback ends. "Video ended" is therefore the reveal (everyone locked in, 5 minutes, or **Reveal now**).

**Caching fix:** `lib/supabase-server.ts` passes `cache: "no-store"` to every server-side fetch. Without it, Next.js cached Supabase reads (stale seat counts and game state).

**Deploy notes:** `deploy.sh` now accepts `SB_REF` (skips the org lookup), reads `VERCEL_TOKEN` from the environment, and works with the current Vercel CLI. Secrets live only in the git-ignored `.env.local` and in Vercel; revoke deploy tokens after use. Redeploy with `npx vercel deploy --prod --scope open-the-box`.

**YouTube Shorts:** parser branch in `lib/embeds.ts`, `'youtube'` allowed by migration 4, labels in the submit page, `TopList.tsx` and `EmbedPlayer.tsx`.

**Admin moderator management**
- `/admin` rows link to `/admin/moderators/[id]`: the moderator's boxes (owned and co-moderated), who is in each (moderators plus the active player roster), queued/played counts and any live game. It shows statuses and counts only, never which player sent which video.
- Admin actions: delete any box (`DELETE /api/admin/groups?id=`), suspend or reactivate an account (`POST /api/admin/moderators`, which also sets the Supabase ban and `moderators.suspended`), delete an account keeping boxes (handed to a co-moderator or the admin) or deleting their boxes too (`DELETE /api/admin/moderators?id=&boxes=delete`). The admin account itself can't be suspended or deleted.
- Suspension takes effect immediately: `requireUser()` checks `moderators.suspended` on every API call and `getMe()` redirects suspended users to `/suspended`. The ban only blocks new logins.

**Grand reveal** (`components/GrandReveal.tsx`, `lib/sfx.ts`)
- When the host screen sees a round flip from `playing` to `reveal`, a short full-screen sequence plays (about **4 seconds** in total as of the Nov 26 (later) update; briefly ~2.5s, originally ~10s): a slot-reel of roster names that lands on the sender (`STEPS = 16`, ~2.3s), a flash, fanfare and confetti, then the sender and average rating (`BOOM_MS = 1700`, rating pill at +0.8s). The "Everyone's locked in" lock beat was removed. Then the results panel appears and each guess slides in (0.2s + 0.1s per guess).
- Sounds are synthesized with WebAudio (no files). There is a mute toggle (`otb-muted` in localStorage) and a Skip button (or tap anywhere). Refreshing mid-reveal skips straight to the results.
- Phones hold back their result screen for `REVEAL_SUSPENSE_MS` (derived from the reel length, about 2.3s) so they don't spoil the big screen. Sync is approximate because each device polls on its own 2-second cycle.

**Immersive "reels" fullscreen** (`lib/immersive.ts`, `components/EmbedPlayer.tsx`)
- Full screen is now edge-to-edge like scrolling Instagram Reels / TikTok. We can't restyle a cross-origin iframe, so the embed is rendered at its native layout size inside a crop window and scaled up (`transform: scale`, origin top-left) so only the video fills the screen. All geometry is in `layoutFor()` and was measured from the real embeds: Instagram reels at 540px wide have a 54px header and a 9:16 video at x=80, y=54, size 380x674 (the header, footer and black side bars are cropped away); a TikTok embed is a 325x578 card (3px inset hides its rounded corners). `place()` picks the scale: contain, plus up to `boost` of extra crop to fill tall phones (Instagram 1.25, TikTok 1.12, other layouts 1). YouTube fills the viewport itself; Facebook and non-reel Instagram posts are shown whole.
- Host controls float over the top as a translucent gradient with a story-style timer bar, honoring `safe-area-inset-top` (`viewport-fit=cover`). (Superseded by the Nov 26 "Faster rounds" section: the player no longer remounts per video and the slide-up animation was replaced by an opacity fade.) Body scroll is locked while full screen. Same iframe in window and full screen mode, so toggling doesn't restart the video.
- If Instagram/TikTok change their embed layout, update the numbers in `layoutFor()`.
- Not possible from outside the iframe: autoplay for Instagram/TikTok (the moderator taps play once per video), and detecting when the video ends.

**Answer timer:** raised from 150s to 300s (5 minutes) by migration `20250101000500_five_minute_timer.sql`, so nobody feels rushed and longer videos fit. It's a DB setting (`app_settings.answer_window_seconds`); the countdown, timer bar and server auto-reveal all read it, and the game still reveals early once everyone has locked in.

**"Finished" (wrap up a game, keep the rest of the box)** (`finishSession` in `lib/game.ts`, action `finish`)
- Host header: **Finish after this video** while a video is playing (it triggers the normal reveal and the big sender reveal, then the moderator hits **Finished**), and **Finished** once revealed (also next to **Next video** on the results panel). The lobby keeps a plain **End game**; the old mid-video "End game" is gone because it threw away the unrevealed video.
- Server: if the video is still `playing` it is revealed first (ratings and guesses count), then the session becomes `finished`. Only videos that were actually shown are marked `played` (in `showVideoAt`), so unplayed videos stay `queued` and are picked up by the box's next game (`beginSession` shuffles all `queued` videos). `current_index` is left on the current video, so the finale's "best video" only considers videos actually shown.
- Stats show as normal: the host finale (top detective, best video, all-time leaderboard) now also says how many videos are still in the box (`finale.remaining`), and phones show their score plus a final scoreboard.
- To continue later: open the box page and start a new game. Scores accumulate in the all-time leaderboard; the per-game "tonight" scores start fresh. (Use **Pause & exit** if you want to resume the same game mid-video instead.)

**YouTube Shorts and Facebook reels in the immersive fullscreen** (`lib/immersive.ts`, `lib/embeds.ts`)
- YouTube: rendered in a 360x640 portrait iframe (the embed then uses its Shorts-style player) and cropped/scaled up like Instagram (boost 1.22). Facebook: the plugin renders a 500x889 9:16 player, handled the same way (boost 1.22).
- **Facebook share links** (`facebook.com/share/r|v|p/CODE`, what the Share button gives) only redirect in JavaScript and the video plugin refuses them ("Video Unavailable"). `resolveFacebookShare()` in `lib/embeds.ts` fetches the page the way Facebook's link-preview crawler does (`facebookexternalhit` user agent), reads the real `og:url` (`/reel/<id>/`) and embeds that. It runs at submit time via `needsExpansion`/`expandUrl`; if the lookup fails it falls back to the original link. Existing Facebook rows in the test box were corrected with a one-off `update videos set embed_url = ...` (data fix, not a migration).

**Playback reliability: unplayable videos, loading states** (`lib/playable.ts`, `components/EmbedPlayer.tsx`)
- Findings from testing every video in the test box with a real browser (iPhone emulation): Instagram decides per reel whether it may play inline. For some reels the embed shows "Watch on Instagram" and tapping play opens instagram.com in a new tab (reproduced with the `/embed/`, `/embed/captioned/` and `embed.js`-style URLs, on desktop and mobile user agents, so no embed variant fixes it). Deleted reels show "link may be broken". Roughly half of the reels in the test box were affected. Cold-vs-warm load cost was only ~0.5s on a decent connection, so slow first loads are not the main cause of black screens.
- `checkPlayable()` asks the platform server-side: Instagram embed page (playable reels contain `video_url`, restricted ones a `WatchOnInstagram` button, removed ones "may be broken"), YouTube oEmbed (401 = embedding disabled, 404 = gone), TikTok oEmbed. Facebook can't be checked (returns `unknown`). It **fails open** (any error, timeout or ambiguity means "play it") and caches results for 30 minutes per server instance.
- (Superseded, see the "No auto-skip" section at the end.) The check was first used to reject unplayable links at submit and to auto-skip them in-game. It is now only used for the heads-up note at submit and for the host's "open it in the app" panel.
- `EmbedPlayer` now shows a loading spinner until the iframe's `load` event plus a beat, then (after 10s) offers **Reload** and **Open on <site>**; if the iframe never loads within 16s it reloads itself once. The host has a **↻** reload button in the top bar (and **Reload video** in window mode). `layout.tsx` adds `preconnect` hints for the four video sites.

**Every accepted link format, end to end** (`lib/embeds.ts`, `lib/playable.ts`, `lib/immersive.ts`)
- Each supported link style was run through expand, parse, playability check and layout, and rendered in a real browser with a phone user agent. Added: TikTok `m.tiktok.com/v/<id>.html`, Facebook `video.php?v=`, Instagram `/share/...` links (302 to the real `/reel/<code>/`). Fixed: an Instagram share token was used as the shortcode. `fb.watch` is not resolvable from a server (it bounces scripts to a login page for every user agent) but Facebook's plugin resolves it, so it is embedded as-is. Unresolvable share links give the submitter "We couldn't open that share link. Open the video in your browser, copy the address and paste that instead".
- `checkMedia()` (and `checkPlayable()` on top of it) now also covers Instagram `/p/` and `/tv/` (same embed page as `/reel/` for the same shortcode) and **Facebook**: the plugin page, fetched with a phone user agent, says "can't be embedded" (music/rights) or "Video Unavailable" (removed), so those get the heads-up note and the host panel like the others.
- Instagram's embed page reports the video's `dimensions`. For the host screen `buildState` adds `video.aspect` (height/width) and `layoutFor(platform, embedUrl, aspect)` crops to the real video box: the media box is 540x674 under a 54px header, a video at least as tall as 4:5 is centred in it (width 674/aspect). Unknown aspect: reels assume 9:16; `/p/` and `/tv/` are shown whole. Square/landscape Instagram videos are shown whole (their media box is unpredictable).
- Facebook gives no orientation hint (it rewrites every video's canonical URL to `/reel/`), so only links that arrive as `/reel/` get the 1.22 crop boost; `watch`, `videos` and `video.php` links are shown whole (a landscape video letterboxes at the top of the 500x889 frame).
- TikTok photo posts render in the same 325x578 card as videos.

**Restricted videos are accepted; the host opens them in the app** (`app/api/submit/route.ts`, `lib/game.ts`, `components/EmbedPlayer.tsx`)
- Change of policy: a video the site won't play inside other apps ("restricted": Instagram reels with embedding off, YouTube with embedding disabled, Facebook music-rights reels) is **no longer rejected at submit** and **no longer auto-skipped**. The submitter sees "Added! Heads up: <site> only plays this one in its own app, so the host will open it there". (Removed/private videos were handled differently at first; that was changed again, see the next section.)
- On the host screen `buildState` adds `video.restricted` (from `checkMedia`, host viewer only). `EmbedPlayer` gets a `blocked` prop: instead of a black iframe it shows an on-brand panel (📲 "This one plays on <site>", an **Open on <site> ↗** button, and a small "Try playing it here anyway" link that loads the iframe). It works in fullscreen (under the timer/controls bar) and in window mode. Slow-load timers are not started while the panel is shown. The Top list player is unchanged (it has no restricted info).
- Videos that earlier games already marked `skipped` for being restricted stay skipped; they are not automatically re-queued.
- The panel's main button is **Open in the <site> app ↗** (`lib/openInApp.ts`, called from the click handler): Android uses an `intent://` link for the app's package (falls back to the website itself if the app is missing), iOS uses the app's URL scheme (`instagram://media?id=<numeric id decoded from the shortcode>`, `youtube://www.youtube.com/shorts/<id>`, `snssdk1233://aweme/detail/<id>` for TikTok, `fb://facewebmodal/f?href=<url>` for Facebook), desktop opens the website in a new tab. A small "Open in the browser instead" link is always there as a fallback. The app links are untested on real phones (no device available when written); iOS shows its own "Open in <app>?" confirmation.

**No auto-skip, every supported link is accepted** (`app/api/submit/route.ts`, `lib/game.ts`, `components/EmbedPlayer.tsx`)
- Rule now: **a link in a supported format is always accepted into the box**, whether the site will play it inside the game or not (restricted, removed or private included). Only unparseable links are `invalid`; `duplicate` and `full` are unchanged. There is no `unplayable` result status any more. The playability check (`checkPlayable`) only picks the heads-up note shown to the submitter ("Added! Heads up: <site> only plays this one in its own app, so the host will open it there", or "... says this one may be removed or private, so the host will check it in the app").
- **Videos are never skipped automatically.** `showVideoAt()` just shows the next video; the `autoSkipped` plumbing and the "Skipped N videos" host notice were removed. The only way a video becomes `skipped` is the moderator's own **Skip** button.
- During the game the host screen gets `video.blocked` (`"restricted"` or `"gone"`, host polling by `sessionId` only) and `EmbedPlayer` shows the panel instead of a black frame: "This one plays on <site>" (restricted) or "This one may be gone" (gone), with **Open in the <site> app ↗** (`lib/openInApp.ts`), "Open in the browser instead" and "Try playing it here anyway". Open-in-app deep links are untested on real phones.

**Personal videos from the camera roll** (`lib/uploads.ts`, `app/api/upload/start|finish`, `app/s/[token]/page.tsx`, `components/EmbedPlayer.tsx`, migration `20250101000600_uploads.sql`)
- Submitters can add up to 5 videos per drop from their phone ("Or add your own video" card on the submit page), mixed into the box with the social links. New video type `upload` (the `videos_platform_check` constraint now allows it; new column `videos.storage_path`).
- Flow: `/api/upload/start` validates (secret box link + roster player, size, type, box not full, at most 40 uploads per box) and returns a one-time **signed upload URL**; the phone PUTs the file straight to Supabase Storage (XHR for progress, so it never passes through Vercel's request-size limit); `/api/upload/finish` checks the object really exists (size and `video/*` mime type via `storage.list`), then inserts the `videos` row (`source_url` = `embed_url` = public URL, `submitted_by` = the player).
- Storage: bucket `box-videos` in project `oqfezbyqlpbqmiqhfnji` (created by the migration): public read, 50 MB per file (the free plan's limit), only `video/mp4|quicktime|webm|x-m4v|3gpp|3gpp2` accepted, **random UUID file names under `<groupId>/`**, so a URL does not reveal the sender (sender stays hidden until the reveal like any other video). Free plan total storage is 1 GB, hence the 40-per-box cap.
- Playback: `EmbedPlayer` renders `platform === "upload"` in a native `<video>` (loops, controls, tries sound first and falls back to muted + "Tap for sound"; fills the stage when the video is close to the screen's shape, otherwise shows it whole). No iframe, so no restricted/blocked state and no slow-load timers.
- **Deletion**: once an uploaded video has been played and rated, its file is deleted (`purgeUpload`): when the host moves on (`nextVideo`), skips it (`skipVideo`) or presses Finished (`finishSession`). The `videos` row is **kept** (tiny) with `storage_path = null` because answers and scores point at it (deleting the row would cascade-delete them). Uploaded videos are excluded from the Top 100 and from the end-of-game "best video". Deleting a box (owner, admin, or admin deleting a moderator with their boxes) removes the box's whole storage folder first (`purgeGroupUploads`, which also sweeps half-finished uploads). A video left unplayed in a box keeps its file until it is played or the box is deleted.
- **Status: built but DORMANT (switched off).** `uploadsEnabled()` in `lib/uploads.ts` reads the server environment variable `UPLOADS_ENABLED`; only the exact value `true` turns uploads on. While it is off, `/api/upload/start` and `/api/upload/finish` answer 403 "Video uploads aren't turned on yet" and `GET /api/submit` returns `uploadsEnabled: false`, so the submit page doesn't show the upload card. To switch on: add `UPLOADS_ENABLED=true` to the Vercel project's production environment variables (never in a committed file) and redeploy; remove it (and redeploy) to switch off again. The bucket `box-videos`, the `upload` type, `storage_path` and `file_bytes` already exist in the database; they are harmless while off.
- **Free-plan safeguards:** besides the per-file 50 MB cap and 40 uploads per box, `MAX_TOTAL_UPLOAD_BYTES` (800 MB across the whole project, summed from `videos.file_bytes` of files not yet deleted; migration `20250101000700_upload_size_tracking.sql`) makes `/api/upload/start` refuse new uploads before the free plan's 1 GB storage quota is hit. Watch egress too: the free plan allows about 5 GB/month and every play of an uploaded video streams from Supabase.
- **Tested** (before the switch was added, against production with a throwaway box, since deleted): validation (too big / not a video / wrong player / other box's path), signed upload with CORS from the app's origin, `finish` (added, duplicate), public URL with range requests (needed for streaming), bucket refusing a non-video mime type, host state shows `platform: "upload"`; and the real game functions `nextVideo`, `skipVideo`, `finishSession` and `purgeGroupUploads` delete the right files and keep the rows, leave social videos and unplayed uploads alone, and the finale's best video is never a personal one.
- **Caveat:** deleting a file removes it from storage (so it stops counting against the quota and fresh requests fail), but Supabase's edge cache can keep serving an already-fetched URL for a while. URLs are random and unlisted, so only someone who already had the link can still fetch it.

**Faster rounds: preloading, the phone tap fix, a 2.5s reveal, and a half point for the sender** (Nov 26 2026; `components/EmbedPlayer.tsx`, `lib/game.ts`, `lib/points.ts`, `components/GrandReveal.tsx`, migration `20250101000800_submitter_half_point.sql`)
- **Preloading the next video.** For the host viewer only, `buildState` returns `upNext` (`embedUrl`, `platform`, `sourceUrl`, `aspect`, `blocked`) for the video after the current one (it also warms the `checkMedia` cache). `EmbedPlayer` is now one persistent stage holding keyed `Slot`s (key = `embedUrl`): the visible slot plus, once the current video has loaded, painted and had a 2.5s breather, one invisible slot for `upNext` (full size, `opacity: 0`, `pointer-events: none`, `aria-hidden`). When the game moves on the same slot is switched on, so the iframe is **not reloaded** and the video shows up instantly. Only one video is loaded ahead. The host page no longer uses `key={embedUrl}` and the reload counter is monotonic (`reloadKey` is a signal, never reset). Preloaded embeds must stay silent: YouTube is loaded with `autoplay=0&enablejsapi=1` and told to play with a `playVideo` postMessage when switched on; uploads preload as a paused `<video preload="auto">` and `play()` when shown; TikTok and Instagram never autoplay anyway. **Facebook and restricted/gone videos are not preloaded** (Facebook's player can't be told to start later, so it loads normally when its turn comes).
- **"Tap does nothing until I refresh" on phones/iPads.** Cause not reproducible without a device. The most likely culprits were (a) the page being scrolled behind the fixed full-screen stage (the Next button is below the video), which on iOS Safari makes taps inside a cross-origin iframe land in the wrong place, and (b) the slide-up `translateY` animation, which can leave iframe hit-testing stale. Fixes: `window.scrollTo(0, 0)` when Start/Next/Resume is clicked and whenever a video takes the full screen; while full screen the body is `position: fixed` with scroll locked (restored afterwards); the stage's `touch-action` is `manipulation` instead of `none`; the entrance animation is an opacity-only fade (`otb-stage-in`). The ↻ reload button stays as a fallback. **This fix needs confirming on a real phone.**
- **Reveal**: about 2.5s (see "Grand reveal" above).
- **Half a point for the sender.** `SENDER_BONUS = 0.5` (`lib/points.ts`). In a session, the sender of each *revealed* video (status `played`, earlier indexes while playing, up to the current one during reveal/finished; skipped videos don't count) gets +0.5 if they joined that game. `buildState.scores` now has `correct`, `bonus` and `points` (sorted by points); `me.score` is `points`. `fmtPoints()` shows whole numbers whole and halves as `3.5`. The all-time `group_leaderboard` view has `submitted` and `points` columns (migration 0800), and the finale, phone scoreboard, host mini scoreboard and leaderboard page use points (the leaderboard page's "Last session" view adds that session's sender bonus itself). The reveal panel and the sender's phone show "+0.5 for sending it".

**The moderator can play along from the host screen** (Nov 26 2026, later same day; `components/HostPlayerPanel.tsx`, wired into `app/g/[groupId]/play/page.tsx`)
- No server changes: the host screen uses the exact same `POST /api/session/join` and `POST /api/session/answer` endpoints a phone uses, so the moderator becomes a normal row in `session_players` and `responses` — same scoring, same decoy handling if the current video happens to be theirs (`is_correct`/`rating` are null for a sender's own answer, same as any player).
- `HostPlayerPanel` keeps its seat in `localStorage` under the **same key a phone uses** (`otb-seat-<CODE>`), verified against the server on load the same way `app/join/page.tsx`'s `Controller` does, and dropped if the player is ever removed from `state.players` (e.g. kicked from the lobby).
- **Visible only when the video is not full screen** (`{!fullscreen && <HostPlayerPanel state={state} />}`): under the "Players in" card in the lobby, and above `MiniScores` on the right-hand column while a video is playing (window mode) or during reveal. It is in the DOM but behind the full-screen stage otherwise, and explicitly not rendered then.
- **Not seated:** "Playing too? Pick your name" — a grid of roster names not already in `state.players`. Tapping one joins.
- **Seated, video playing, not yet answered:** a 1-10 rating grid and a guess grid of the rest of the roster, styled identically whether or not a button has been tapped (so the shared screen never shows a selection) — the only visible change is the **Lock in** button going from disabled/greyed (`.btn`'s `disabled:opacity-50`) to enabled once both a rating and a guess are chosen. Submitting calls `/api/session/answer`; after that (or during reveal / lobby) it just shows "Playing as `<name>`" or "🔒 Locked in", never a result.
- Because the moderator is now a normal `session_players` row, server-side auto-reveal (`maybeAutoReveal`, "everyone answered") waits on them too, same as any player.

---

## 12. Full app hardening pass (Nov 2026): reliability, flow, performance, design, security, code health

Three phases, each type-checked and build-verified, shipped as separate commits on `master`, then deployed together.

### Phase 1 — security and server-side reliability (no UI changes)
- **Rate limiting tightened**: per-device state polling is now limited (not just joins/submissions/sign-ups), and wrong-code lookups on `/api/session/join` get their own tighter limit (`codemiss:<ip>`, 30 per 10 minutes) separate from the general join limit, since repeated misses look like code-guessing. See the table in section 4.
- **Host view requires a moderator**, with the group-mod check cached per request instead of re-queried.
- **The player token moved from the URL query string to an `x-otb-token` header** on `/api/session/state`, so it never shows up in server access logs or browser history.
- **Guards against races**: `showVideoAt`/`beginSession`/skip now take an `expectIndex` and use a conditional update (`where current_index = expectIndex`), so a double-tap or two moderators clicking at once can't advance the video twice or desync `video_order`. Answer submission re-checks eligibility and sends a single broadcast instead of one per write. A kicked player's old answers are excluded from counts. `/api/session/join` returns specific error codes (full room, name taken, game over) instead of a generic failure.
- **`buildState` (the hot path, called on every poll)**: the answer-window setting is cached in memory for 60s instead of queried every call; auto-reveal and the videos-shown lookup are batched into fewer round trips; the finale calculation is cached per session once computed; the realtime broadcast has a timeout so a slow/stuck broadcast can't block the response; a database read error now returns `503` instead of a generic `500` or a silent bad state.
- **Migration `0900`**: adds indexes used by the hot-path queries, a partial unique index enforcing **one open (non-ended) session per box** (guarded by an application-level duplicate check before relying on it), rewrites the `group_leaderboard` view, and adds `videos.playability`/`videos.aspect` columns so the playability check and aspect ratio (previously recomputed live) are saved at submit time and just read back on the host view.
- Shipped with throwaway-box tests directly against production (guards, kicked-player exclusion, host-auth enforcement, an 11-simulated-device poll burst, saved playability round-tripping) before deploying.

### Phase 2 — refactor (no behavior change)
- `play/page.tsx` (previously one large file) split into `components/host/HostHeader.tsx`, `LobbyView.tsx`, `StageView.tsx`, `RevealPanel.tsx`, `MiniScores.tsx`, `Finale.tsx`. `play/page.tsx` itself is now just state plumbing (`useGameState`, `act()`, the preload-next-video effect) and picks which host view to render.
- `lib/fullscreen.ts` pulled out the native-fullscreen/scroll-reset helpers that were inline in `play/page.tsx`.
- `useSeat.ts` extracted the "claim a seat" lifecycle that `app/join/page.tsx` and `HostPlayerPanel` had each implemented separately, so there's one place that owns the `otb-seat-<CODE>` localStorage key and its re-validation.
- Fixed a leftover bug while refactoring: `app/s/[token]/page.tsx`'s submission-verdict `setTimeout` wasn't cleared on unmount or on a rapid "try again" tap (it's called both automatically after a successful submission and manually from a "try again" button); now tracked in a ref and cleared before each reschedule and on unmount.

### Phase 3 — client reliability, flow, design/a11y, performance, then ship

**Client reliability** (`components/useGameState.ts`, `app/g/[groupId]/play/page.tsx`)
- Polling changed from a fixed `setInterval` to a **self-rescheduling `setTimeout`** that: pauses while the tab is hidden or the game is `finished` (a realtime nudge still refetches in both cases), uses a longer interval in the lobby, and always reschedules fresh after each fetch so a realtime-triggered refresh never leaves a near-duplicate poll right behind it. A `visibilitychange` listener forces an immediate refresh when the tab becomes visible again.
- A realtime nudge arriving while a fetch is already in flight is **coalesced** into one follow-up refresh instead of firing overlapping requests.
- Renders are skipped when a poll returns the exact same state except for the live countdown fields (deep-equal comparison with timer fields zeroed out first), so a 2-second poll with nothing new doesn't force a re-render.
- A **`reconnecting` flag** (returned from `useGameState`) flips on after two consecutive failed/errored polls, or immediately if `navigator.onLine` is `false`, and clears on the next success. `HostHeader` and the phone controller (`app/join/page.tsx`) both show a "Reconnecting…" pill when it's set.
- `act()` (the host's action dispatcher) now wraps its fetch in `try/catch/finally`, always calls `refresh()` and clears the busy flag regardless of outcome, and reports success/failure back to the caller — `pauseAndExit()` only navigates away if the pause actually succeeded, instead of leaving if the request failed.

**Flow / UX** (`components/useWakeLock.ts`, `components/host/HostHeader.tsx`, `components/host/StageView.tsx`, `components/HostPlayerPanel.tsx`, `app/join/page.tsx`, `components/host/LobbyView.tsx`, `components/host/RevealPanel.tsx`)
- **Screen Wake Lock**: both the host stage and the phone controller request `navigator.wakeLock` while a game is in progress (`useWakeLock`), re-acquiring on `visibilitychange` since browsers auto-release it when backgrounded.
- **Host header/toolbar now fit a phone-width host screen**: the header wraps and hides the join-code pill below `md` once the game has started; the fullscreen toolbar collapses Skip/Reload/Pause into a "⋯ More" menu below `sm`.
- **Answer bottom sheet**: when the moderator is seated and playing along in fullscreen, a "📝 Answer" button opens `HostPlayerPanel` as a bottom sheet over the video (`fixed inset-x-0 bottom-0`, safe-area-aware padding) instead of it being unreachable behind the fullscreen stage. The sheet container is always mounted (toggled via a CSS class, not unmounted) so `HostPlayerPanel`'s own seat-check effect doesn't re-run every time it opens; it auto-closes once the moderator locks in.
- **Sticky action bar**: the Reveal/Skip (playing) and Next/Finished (reveal) buttons are pinned to the bottom of the screen below `lg`, so they're reachable without scrolling past the guess list on a phone-width host screen; they revert to normal inline flow at `lg`+.
- **Phone controller** (`app/join/page.tsx`): a "You rated N, guessed X" summary is written to `sessionStorage` (`otb-lockin-<code>-<index>`) right when you lock in and read back on refresh, so reloading mid-wait doesn't lose it. Network errors during code lookup are now caught and shown (not just non-2xx responses). Being kicked and needing to re-pick your name now shows an explicit message. Vibrate-on-lock-in only fires for a real (non-decoy) rating, matching the decoy logic elsewhere. Safe-area insets (`env(safe-area-inset-*)`) are respected on the main padding and the sticky Lock-in button.
- **Lobby roster** (`LobbyView.tsx`): player avatars show a small "×" kick badge instead of relying purely on a click-to-confirm interaction being discoverable; `/join`'s roster-pick screen shows "(taken)" next to names already claimed.
- **Reveal panel guess list** (`RevealPanel.tsx`): two-column layout from `lg` up (a TV being watched from across the room), instead of a single scrolling column.

**Design / accessibility** (project-wide contrast pass, `components/GrandReveal.tsx`, `components/host/RevealPanel.tsx`, `app/join/page.tsx`, `components/host/StageView.tsx`, `lib/confetti.ts`, `components/Providers.tsx`, `app/globals.css`, `app/layout.tsx`)
- **Contrast**: every `text-white/40`/`/50`/`/60` occurrence project-wide was bumped to `text-white/70` (the minimum the plan called readable); the one `text-[11px]` occurrence became `text-xs`.
- **Long names**: `GrandReveal`'s reel/winner name and `RevealPanel`'s sender name now pick a smaller text size as the name gets longer, instead of overflowing or wrapping awkwardly.
- **ARIA**: icon-only buttons (reload, pause, mute, the "more actions" toggle) got `aria-label`s with their emoji wrapped in `aria-hidden` spans; rating/guess tiles on the **phone** got `aria-pressed` — deliberately **not** added to the host's hidden-selection tiles in `HostPlayerPanel`, since that would leak the selection to assistive tech on a screen everyone can see.
- **Reduced motion**: the whole app is wrapped in framer-motion's `MotionConfig reducedMotion="user"` (`components/Providers.tsx`), plus a CSS `prefers-reduced-motion` backstop in `app/globals.css` for anything animated with plain CSS transitions. `canvas-confetti` is still called (it respects `disableForReducedMotion` itself via `lib/confetti.ts`).
- **Focus rings**: a global `:focus-visible` rule (`app/globals.css`) gives every button/link/input a visible ring, since many of the app's interactive elements are custom-styled `<button>`s that don't get a visible default outline.
- **Pinch-zoom**: `maximumScale: 1` was removed from the `viewport` export in `app/layout.tsx` (it was blocking pinch-to-zoom, an accessibility anti-pattern).

**Performance** (`components/LiveCountdown.tsx`, `components/TimerBar.tsx`, `components/EmbedPlayer.tsx`, `components/host/LobbyView.tsx`, `app/layout.tsx`, `app/g/[groupId]/play/layout.tsx`)
- **Countdown ticking moved into leaf components**: `LiveCountdown` and `TimerBar` each own a private 250ms `setInterval` and take the raw server snapshot (`remainingMs` + `fetchedAt`) as props, instead of the parent page re-rendering 4 times a second to recompute a `ms` value and pass it down. `useGameState`'s old `useCountdown` hook is gone.
- `EmbedPlayer` is wrapped in `memo()` so an iframe holding a cross-origin video doesn't get torn down and rebuilt on unrelated state changes.
- `canvas-confetti`, `qrcode.react`'s `QRCodeSVG`, and `GrandReveal` are all loaded via `next/dynamic({ ssr: false })` (confetti through the `lib/confetti.ts` wrapper), so they're split into their own on-demand chunks instead of sitting in the initial bundle for every page.
- `Fredoka`/`Nunito` are loaded without an explicit `weight` array, since both ship as variable fonts on Google Fonts — this loads one variable file instead of three or four static-weight files.
- The video-site `preconnect`/`dns-prefetch` hints moved out of the root layout and into a route-scoped `app/g/[groupId]/play/layout.tsx` (relying on Next's automatic `<link>` hoisting), so pages that never embed a video don't pay for those connections.

**Shipping**
- Re-verified end to end with a local Puppeteer harness running the real app (built from the real source, pointed at the production Supabase project) against a throwaway fixture box, cleaned up (DB rows and the throwaway Supabase Auth user) immediately after: login, open the box, two phones joining, starting the game, the moderator seating as a non-sender player and reaching the Answer sheet, the sticky action bar at phone width, the lock-in summary (including surviving a reload), `prefers-reduced-motion` emulation, the reconnecting pill (going offline and back), and stage preload.
- One lesson from building that harness worth keeping in mind for future ones: **`useSeat`/`HostPlayerPanel` is a per-component-instance hook** — `StageView` mounts a different `HostPlayerPanel` instance depending on whether the stage happens to be in its windowed or fullscreen layout at that moment, so a UI click that seats a player can land on an instance that gets unmounted a moment later (the `localStorage` write survives; the in-memory seat doesn't). Seeding `localStorage` directly and reloading avoids that race in a harness; a real user doesn't hit it because they aren't toggling fullscreen state at the exact instant they tap "pick a name".

**Instagram reels: direct MP4 playback** (`lib/igDirect.ts`, `lib/game.ts`, `components/EmbedPlayer.tsx`, migration `20250101001000_direct_url.sql`)
- The single biggest UX complaint: Instagram's cross-origin embed can't autoplay, never reports when a video ends, and for some reels refuses to play inline at all ("restricted" — see the "Playback reliability" section above). Fix: resolve the reel to its actual MP4 file and play it in a native `<video>`, same as an uploaded video.
- **Step 1, always, no login:** the public embed page (the same page `checkMedia` already fetches) contains `video_url` for any reel that's playable inline. Instagram's own CDN (`*.cdninstagram.com`) answers with `access-control-allow-origin: *` and `accept-ranges: bytes`, so the browser can play (and seek) the file directly from our own origin — confirmed with a real reel (`206 Partial Content`, CORS wide open). The link is signed and expires after roughly a day (the `oe=` hex-timestamp query param); `lib/igDirect.ts`'s `extractVideoUrl()` finds `"video_url"` in the page text and strips every backslash out of the captured run rather than trying to count JSON escape levels (the blob is doubly-escaped — `/` can show up as one or more backslashes before a slash — and a URL never legitimately contains a backslash, so this is simpler and more robust than a strict JSON-string regex).
- **Step 2, only if step 1 finds nothing, only if `IG_SESSIONID` is set:** a logged-in lookup using a spare Instagram account's session cookie, against the private app API (`i.instagram.com/api/v1/media/<id>/info/`, shortcode converted to a numeric media id via Instagram's own base64url alphabet) and, if that fails, the embed page again with the cookie attached. This is the only way found to get a **restricted** reel's file — every anonymous route was tried against a real restricted reel and all failed: the embed page, the captioned embed variant, fetching the reel page as Facebook's/Twitter's/WhatsApp's link-preview bot (no `og:video`), `?__a=1` (404), and web GraphQL even with anonymous cookies (401, wants a logged-in session).
- This is against Instagram's terms of service: the account doing the lookup can be challenged, rate-limited or banned, and the endpoints can change without notice. Guardrails: only ever looked up for the host's current + next video (never at submit time), at most one lookup in flight per shortcode, and a 10-minute backoff on the logged-in step after a 401/403 (so a dead session isn't retried on every poll).
- **Caching:** the resolved link and its expiry are saved on the `videos` row (`direct_url`, `direct_url_expires`). `mediaInfo()` in `lib/game.ts` returns the cached link while it's still valid; once it expires, the next host poll for that video re-resolves and re-saves it. This means an Instagram video typically costs one extra fetch per day it's shown, not one per poll.
- **Frontend:** `UploadVideo` in `EmbedPlayer.tsx` was generalized into `NativeVideo` (same loop/sound-first/tap-for-sound/cover-vs-contain behavior) and is now used both for camera-roll uploads and for `platform === "instagram"` videos that have a `directUrl`. It preloads the same way uploads do (paused, buffering). If the file never becomes playable (expired link, decode failure, or a stall — no event fires at all for a dead link, so there's a 9s backstop timer) it calls `onError` once, which flips the slot back to the plain iframe (or the blocked panel), so nothing is ever worse than before this change. `directUrl` is host-only and never sent to phones.
- **Verified:** the resolver against 3 real playable reels and 1 real restricted reel (anonymous step correctly resolves the playable ones and correctly returns nothing for the restricted one); the resolved CDN link's headers directly (range request, CORS, content-type); a standalone Playwright harness exercising the real `EmbedPlayer` component with a valid link (renders `<video>`, not `<iframe>`, `currentTime` advances — it's actually playing) and a broken one (falls back to the iframe within seconds); and a full production run — a throwaway moderator account (created via the Auth admin API with the service-role key, approved by SQL, deleted after) logged into the live site, created a throwaway box with one playable and one restricted reel, started a real game, and confirmed on the real host screen that the restricted reel shows today's "This one plays on Instagram" panel (no `IG_SESSIONID` configured yet) while the playable one renders and plays as a native video — then every throwaway row and the auth user were deleted and verified gone.
- **Status: the logged-in step (restricted reels) is untested end-to-end** — it needs a spare Instagram account's `sessionid`, which isn't set up yet (`IG_SESSIONID` isn't in Vercel's production env). Until it is, restricted reels behave exactly as before (the open-in-app panel); playable reels already get native playback today. To turn it on: create a spare account, copy its `sessionid` cookie, add it to Vercel production (`IG_SESSIONID`) and redeploy — no code changes needed.
- **Follow-up fix: the spare account's fallback stays wired even after a successful resolve.** The first version marked a reel's `playability` as `"ok"` in the DB the moment *any* direct link resolved for it, including ones that only worked because of the spare account's session. If that session later died (banned, rotated out), the stale `"ok"` would hide the "open it in the app" panel forever, leaving a dead native video with no fallback. Fixed: `resolveInstagramVideo()` now tags each link `"anonymous"` (genuinely embeddable, safe to mark `"ok"` for good) or `"session"` (still restricted — `playability` is left alone, or determined fresh via `checkMedia()`), and `mediaInfo()` can now return `blocked` *alongside* `directUrl` for session-only reels, so `EmbedPlayer` plays the native video but still has the panel ready to fall back to if it ever stops working.

**Reveal sequence timing** (`components/GrandReveal.tsx`)
- The "sent by…" slot-machine reveal was lengthened from ~4s (2.3s reel + 1.7s winner) to ~6.5s (3.8s reel + 2.7s winner), scaling both phases by the same factor so the pacing/suspense curve is unchanged, just longer. `REVEAL_SUSPENSE_MS` (how long phones hold back their own reveal so they don't spoil the host's big screen) is derived from the reel duration automatically, so it didn't need a separate change.

**Smoother mirroring to the TV: a lighter stage, plus real AirPlay video for direct files** (Nov 26 2026; `components/TimerBar.tsx`, `components/LiveCountdown.tsx`, `components/Countdown.tsx`, `components/host/StageView.tsx`, `app/globals.css`, `components/EmbedPlayer.tsx`, `components/useWakeLock.ts`)
- **Why:** AirPlay screen mirroring to an Apple TV makes the iPhone decode the video, draw the page on top of it, compress the whole screen into H.264 and send it over Wi-Fi — every single frame. Part A makes the page itself lighter to encode during that mirroring. Part B skips mirroring altogether for videos that are already a direct file (uploads, resolved Instagram reels) by sending them to the TV as a real AirPlay video stream instead.
- **Part A — less changes per frame while a video is playing:**
  - `TimerBar` no longer rewrites a `width` style every 250ms; it now sets a `transform: scaleX(...)` once per server poll with a single linear CSS `transition` that runs it down to zero on its own, plus one-shot `setTimeout`s for its color-threshold changes, so the browser's compositor animates it instead of a re-render doing it.
  - `LiveCountdown` ticks once a second instead of every 250ms, self-rescheduling to land exactly on each second boundary. `Countdown`'s ring `stroke-dashoffset` transition is now ~1s to match that cadence for routine ticks, but snaps instantly (no transition) on a big jump in its `ms` prop — a new video, or a pause/resume — via a `prevMs` ref comparison, so the ring doesn't visibly sweep across half the circle every time the clock resets.
  - `backdrop-blur` was dropped from the sticky action bar and from the "Rate it & guess who sent it!" card (`app/globals.css`'s new `.card-flat`, identical to `.card` minus the blur) while `s.state === "playing"` — blurring whatever sits behind them had to be redone every frame.
  - The fullscreen overlay (`StageView`'s overlay builder, read by `EmbedPlayer`) now auto-hides down to just the thin timer bar and a small countdown after ~4s without a touch: the gradient background and the whole buttons row (Reveal now / Answer / Skip / Reload / Pause / More / Exit) fade out, with `aria-hidden`/`tabIndex={-1}` applied to the hidden row. Any tap on the stage brings it back for another 4s; opening the Answer sheet or the More menu (`pinOverlay`) holds it up regardless of the idle timer.
  - (Already in place before this round of work, comment only refreshed: `useWakeLock.ts` holds `navigator.wakeLock` for the host stage so the screen doesn't dim or lock mid-game.)
- **Part B — AirPlay direct-file videos as a real stream, not mirrored pixels:**
  - `EmbedPlayer` now owns exactly one persistent native `<video>` element (`StageNativeVideo`) for the whole stage, instead of a fresh one per clip — the *same* element plays every upload and resolved Instagram reel in the game, only its `src` changes between them, because an AirPlay connection is tied to a specific element and swapping `src` in place gives it the best chance of surviving from one native clip to the next. The upcoming native clip is warmed into the browser's HTTP cache by a tiny hidden `<video muted preload="auto" style={{ display: "none" }}>` (`NativeBufferPreload`) rather than a second visible/playable element, so there is never a second AirPlay target on screen.
  - A **"Play on TV"** button appears whenever the current clip is playing through that native `<video>`. It's rendered by `EmbedPlayer` itself, tucked into its own corner of the fullscreen stage and fading with the same overlay idle timer as the rest of the controls — deliberately *not* threaded through `StageView`'s `overlay` prop, since StageView doesn't need to know anything about AirPlay at all. `useAirPlay()` tries the Remote Playback API (`video.remote.prompt()`, Safari 13.1+) first, falling back to the older WebKit-only `video.webkitShowPlaybackTargetPicker()` if `remote` isn't usable or `.prompt()` rejects — both calls happen synchronously inside the button's `onClick`, since Safari only honors the picker as a response to a direct user gesture. Connection state (the Remote Playback API's `connecting`/`connect`/`disconnect` events, or `webkitcurrentplaybacktargetiswirelesschanged` on the fallback path) drives a `casting` boolean. Tapping the button again while already casting just reopens the same system picker, which is where iOS puts the disconnect option, so there's no separate "stop casting" code path to write.
  - While `casting` is true, the video's visible area is swapped for a plain "Playing on your TV 📺" placeholder — the `<video>` itself keeps playing untouched, and every other control (the overlay buttons, the Answer sheet, Skip/Reload/Pause) stays exactly as usable as before. On disconnect, or once the game moves on to a clip that isn't native, playback simply continues locally the normal way: `casting`/`isNativeNow` flipping back to `false` is the only thing that changes, there's no extra teardown path.
  - Everything here fails open by design: any missing API, or a feature-detection throw, just leaves the "Play on TV" button unshown rather than touching normal local playback.
  - **Confirmed:** a clean `tsc --noEmit` and `next build` with these changes in place.
  - **Not yet confirmed — needs a real iPhone + Apple TV, can't be tested from here:** whether the AirPlay session survives a `src` swap on the same `<video>` element when the game moves on to the next native clip (if it doesn't, AirPlay is still one tap away per clip on the button, which works the same either way); and whether iOS returns to screen mirroring on its own once an AirPlay video session ends or disconnects, for a host who had mirroring turned on before the clip started.
- **Host tips that aren't about the app at all:** put the Apple TV on Ethernet or 5GHz Wi-Fi rather than 2.4GHz; turn off Low Power Mode on the phone (it throttles a lot, mirroring included); close other apps running in the background on the phone; keep the phone plugged in and not buried in a pocket/case during a long game — mirroring plus a live Wi-Fi video stream keeps the CPU and radio busy enough to get warm.

