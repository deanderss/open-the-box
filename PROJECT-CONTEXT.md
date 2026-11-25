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
- When the host screen sees a round flip from `playing` to `reveal`, a full-screen sequence plays: "Everyone's locked in" with a drum roll, a slot-reel of roster names that slows and lands on the sender, a flash, fanfare and confetti, then the sender and average rating. Then the results panel appears and each guess slides in.
- Sounds are synthesized with WebAudio (no files). There is a mute toggle (`otb-muted` in localStorage) and a Skip button. Refreshing mid-reveal skips straight to the results.
- Phones hold back their result screen for `REVEAL_SUSPENSE_MS` (about 5.7s) so they don't spoil the big screen. Sync is approximate because each device polls on its own 2-second cycle.

**Immersive "reels" fullscreen** (`lib/immersive.ts`, `components/EmbedPlayer.tsx`)
- Full screen is now edge-to-edge like scrolling Instagram Reels / TikTok. We can't restyle a cross-origin iframe, so the embed is rendered at its native layout size inside a crop window and scaled up (`transform: scale`, origin top-left) so only the video fills the screen. All geometry is in `layoutFor()` and was measured from the real embeds: Instagram reels at 540px wide have a 54px header and a 9:16 video at x=80, y=54, size 380x674 (the header, footer and black side bars are cropped away); a TikTok embed is a 325x578 card (3px inset hides its rounded corners). `place()` picks the scale: contain, plus up to `boost` of extra crop to fill tall phones (Instagram 1.25, TikTok 1.12, other layouts 1). YouTube fills the viewport itself; Facebook and non-reel Instagram posts are shown whole.
- Host controls float over the top as a translucent gradient with a story-style timer bar, honoring `safe-area-inset-top` (`viewport-fit=cover`). Each new video remounts the player (`key=embedUrl`) and slides up (`@keyframes otb-reel-in`). Body scroll is locked while full screen. Same iframe in window and full screen mode, so toggling doesn't restart the video.
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

