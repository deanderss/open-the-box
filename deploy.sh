#!/usr/bin/env bash
# Open the Box — one-shot deploy. Needs: SB_TOKEN, SB_DB_PASS, VERCEL_TOKEN (env).
# Never echoes secrets. Safe to re-run (reuses existing project / skips applied schema).
set -euo pipefail
cd "$(dirname "$0")"
API=https://api.supabase.com/v1
PROJECT_NAME=open-the-box
REGION=${REGION:-us-east-1}
log() { echo "[$(date +%H:%M:%S)] $*"; }
jget() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);const v=($1);process.stdout.write(v==null?'':String(v))})"; }
sb() { curl -sS -H "Authorization: Bearer $SB_TOKEN" -H "Content-Type: application/json" "$@"; }

PHASE=${PHASE:-all}
if [ "$PHASE" = "all" ] || [ "$PHASE" = "supabase" ]; then
: "${SB_DB_PASS:=$(node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))")}"
export SB_DB_PASS
# ── 1. Supabase project ──────────────────────────────────────────────
if [ -n "${SB_REF:-}" ]; then
  # Fixed project ref supplied: skip org lookup / project creation (token may lack organizations_read).
  REF=$SB_REF
  log "Using supplied Supabase project ref."
else
log "Checking Supabase account…"
ORGS=$(sb "$API/organizations")
ORG_ID=$(echo "$ORGS" | jget 'Array.isArray(o)&&o[0]?o[0].id:null')
[ -z "$ORG_ID" ] && { echo "ERROR: could not read Supabase organizations (token invalid?)"; echo "$ORGS" | head -c 300; exit 1; }
log "Organization found."

REF=$(sb "$API/projects" | jget "(o.find(p=>p.name==='$PROJECT_NAME')||{}).id")
fi
if [ -z "$REF" ]; then
  log "Creating Supabase project '$PROJECT_NAME' in $REGION…"
  BODY=$(node -e "process.stdout.write(JSON.stringify({name:'$PROJECT_NAME',organization_id:process.argv[1],db_pass:process.env.SB_DB_PASS,region:'$REGION',plan:'free'}))" "$ORG_ID")
  RES=$(sb -X POST "$API/projects" -d "$BODY")
  REF=$(echo "$RES" | jget 'o.id||null')
  [ -z "$REF" ] && { echo "ERROR creating project:"; echo "$RES" | head -c 500; exit 1; }
else
  log "Re-using existing project."
fi
log "Project ref: $REF"

log "Waiting for database to be ready…"
for i in $(seq 1 60); do
  ST=$(sb "$API/projects/$REF" | jget 'o.status')
  [ "$ST" = "ACTIVE_HEALTHY" ] && break
  sleep 10
done
log "Status: $ST"
[ "$ST" != "ACTIVE_HEALTHY" ] && { echo "ERROR: project not healthy yet ($ST). Re-run later."; exit 1; }

q() { node -e 'process.stdout.write(JSON.stringify({query:require("fs").readFileSync(0,"utf8")}))' | sb -X POST "$API/projects/$REF/database/query" --data-binary @-; }

# ── 2. Schema ────────────────────────────────────────────────────────
HAS=$(echo "select to_regclass('public.app_settings') is not null as ok;" | q | jget 'Array.isArray(o)&&o[0]?o[0].ok:null')
if [ "$HAS" != "true" ]; then
  log "Applying database schema…"
  for i in $(seq 1 6); do
    OUT=$(cat supabase/migrations/*.sql | q) || true
    if echo "$OUT" | grep -q '"message"'; then
      echo "$OUT" | head -c 600; echo; log "retrying in 15s…"; sleep 15
    else break; fi
  done
  HAS=$(echo "select to_regclass('public.app_settings') is not null as ok;" | q | jget 'Array.isArray(o)&&o[0]?o[0].ok:null')
  [ "$HAS" != "true" ] && { echo "ERROR: schema not applied"; exit 1; }
fi
log "Schema in place."

# ── 3. API keys ──────────────────────────────────────────────────────
KEYS=$(sb "$API/projects/$REF/api-keys?reveal=true")
ANON=$(echo "$KEYS" | jget "(o.find(k=>k.name==='anon')||{}).api_key")
SERVICE=$(echo "$KEYS" | jget "(o.find(k=>k.name==='service_role')||{}).api_key")
[ -z "$ANON" ] || [ -z "$SERVICE" ] && { echo "ERROR: could not read API keys"; exit 1; }
SB_URL="https://$REF.supabase.co"
CRON_SECRET=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")
umask 077
cat > .env.local <<EOF
NEXT_PUBLIC_SUPABASE_URL=$SB_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON
SUPABASE_SERVICE_ROLE_KEY=$SERVICE
CRON_SECRET=$CRON_SECRET
EOF
log "API keys saved locally (.env.local, not uploaded)."
echo "$REF" > .supabase-ref
# Signup/mailer flags only, for now — the redirect allow-list itself is set further down, once the real
# production domain is known (see "Locking down login redirect settings" below). Setting it here used to mean
# guessing the domain before it existed, which is how it ended up pinned to the wrong one *and* wide open to
# every "*.vercel.app" preview deployment (a password-reset email's redirect can be pointed at an attacker's
# own Vercel app with that wildcard in place — the one-time code then lands on their site, not yours).
AUTH_BODY=$(node -e "process.stdout.write(JSON.stringify({mailer_autoconfirm:true,disable_signup:true}))")
AUTH_RES=$(sb -X PATCH "$API/projects/$REF/config/auth" -d "$AUTH_BODY")
echo "$AUTH_RES" | grep -q '"mailer_autoconfirm"' && log "Auth configured." || { echo "WARN auth config:"; echo "$AUTH_RES" | head -c 300; echo; }
log "SUPABASE PHASE DONE ✅"
fi

if [ "$PHASE" = "all" ] || [ "$PHASE" = "vercel" ]; then
set -a; . ./.env.local; set +a
SB_URL=$NEXT_PUBLIC_SUPABASE_URL; ANON=$NEXT_PUBLIC_SUPABASE_ANON_KEY; SERVICE=$SUPABASE_SERVICE_ROLE_KEY

# ── 4. Vercel ────────────────────────────────────────────────────────
export VERCEL_TOKEN
vc() { npx vercel "$@" --scope "${VERCEL_SCOPE:-open-the-box}" --yes; }
log "Linking Vercel project…"
vc link --project "$PROJECT_NAME" >/dev/null 2>&1 || vc link --project "$PROJECT_NAME"
setenv() {
  # $3 = --no-sensitive (public config) or --sensitive (secret); value goes via stdin, never argv
  printf "%s" "$2" | vc env add "$1" --environment production --force "$3" >/dev/null 2>vercel-env.err || { echo "ERROR setting env $1"; sed -E 's/eyJ[A-Za-z0-9._-]+/[REDACTED]/g' vercel-env.err | tail -5; exit 1; }
}
log "Setting environment variables…"
setenv NEXT_PUBLIC_SUPABASE_URL "$SB_URL" --no-sensitive
setenv NEXT_PUBLIC_SUPABASE_ANON_KEY "$ANON" --no-sensitive
setenv SUPABASE_SERVICE_ROLE_KEY "$SERVICE" --sensitive
setenv CRON_SECRET "$CRON_SECRET" --sensitive
rm -f vercel-env.err

log "Deploying to production (this takes 1–3 minutes)…"
DEPLOY_URL=$(vc deploy --prod 2>deploy.err | tail -1) || { tail -30 deploy.err; exit 1; }
log "Deployment: $DEPLOY_URL"

PROJ_ID=$(node -e "console.log(require('./.vercel/project.json').projectId)")
TEAM_ID=$(node -e "const p=require('./.vercel/project.json');console.log(p.orgId&&p.orgId.startsWith('team_')?p.orgId:'')")
TQ=""; [ -n "$TEAM_ID" ] && TQ="?teamId=$TEAM_ID"
DOMAIN=$(curl -sS -H "Authorization: Bearer $VERCEL_TOKEN" "https://api.vercel.com/v9/projects/$PROJ_ID/domains$TQ" | jget "(o.domains||[]).map(d=>d.name).sort((a,b)=>a.length-b.length)[0]")
[ -z "$DOMAIN" ] && DOMAIN=$(echo "$DEPLOY_URL" | sed -E 's#https?://##')
SITE="https://$DOMAIN"
log "Live URL: $SITE"

# Make production deployments publicly reachable (no Vercel login wall)
curl -sS -X PATCH -H "Authorization: Bearer $VERCEL_TOKEN" -H "Content-Type: application/json" \
  "https://api.vercel.com/v9/projects/$PROJ_ID$TQ" -d '{"ssoProtection":null}' >/dev/null || true

echo "$SITE" > .live-url

# Now that the real production domain is known, lock the auth redirect allow-list down to exactly that — not
# the "https://*.vercel.app/**" wildcard this used to carry, which let anyone's own Vercel app receive a
# password-reset/magic-link redirect for any account here. No localhost entry either: that only matters for
# local dev, which can add it back by hand if ever needed, and it has no business in the production config.
[ -z "${REF:-}" ] && REF=$(cat .supabase-ref 2>/dev/null || true)
if [ -n "${REF:-}" ]; then
  log "Locking login redirects to $SITE…"
  AUTH_BODY=$(node -e "process.stdout.write(JSON.stringify({site_url:process.argv[1],uri_allow_list:process.argv[1]+'/**'}))" "$SITE")
  AUTH_RES=$(sb -X PATCH "$API/projects/$REF/config/auth" -d "$AUTH_BODY")
  echo "$AUTH_RES" | grep -q '"site_url"' && log "Auth redirects locked to $SITE." || { echo "WARN auth config:"; echo "$AUTH_RES" | head -c 300; echo; }
else
  log "WARN: no Supabase project ref found (.supabase-ref missing and SB_REF unset) — skipping auth redirect lock-down."
fi
log "DONE ✅  $SITE"
fi
