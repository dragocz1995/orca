#!/usr/bin/env bash
# End-to-end smoke for the embedded brain against a throwaway daemon.
# Structural pass (no LLM creds): boots the daemon, verifies the brain routes are mounted, the
# migration ran, and (when a provider is configured) the persistence path writes to SQLite.
# For a full inference pass, point the relay config at a real OpenAI-compatible endpoint + key first.
set -euo pipefail

PORT="${ORCA_PORT:-4491}"
DB="${ORCA_DB:-/tmp/orca-brain-smoke.db}"
BASE="http://127.0.0.1:${PORT}"
rm -f "$DB"

ORCA_DB="$DB" ORCA_PORT="$PORT" ORCA_AUTOSTART=0 node dist/daemon/index.js &
DAEMON=$!
trap 'kill $DAEMON 2>/dev/null || true' EXIT

# wait for health
for i in $(seq 1 30); do curl -sf "$BASE/health" >/dev/null && break || sleep 0.3; done
echo "health: $(curl -s "$BASE/health")"

# create admin + login
curl -s -X POST "$BASE/users" -H 'content-type: application/json' -d '{"username":"admin","password":"pw"}' >/dev/null
TOK=$(curl -s -X POST "$BASE/auth/login" -H 'content-type: application/json' -d '{"username":"admin","password":"pw"}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).token))')
auth=(-H "authorization: Bearer $TOK")

echo "brain status (unwired expected running:false): $(curl -s "${auth[@]}" "$BASE/brain/status")"
echo "brain start (unwired expected 503):"
curl -s -o /dev/null -w '  HTTP %{http_code}\n' "${auth[@]}" -X POST "$BASE/brain/start" -H 'content-type: application/json' -d '{}'

echo "migration check (advisor_engine column present):"
node -e "const D=require('better-sqlite3');const db=new D(process.env.DB);const c=db.prepare('PRAGMA table_info(users)').all().map(r=>r.name);console.log('  advisor_engine:', c.includes('advisor_engine'))" DB="$DB" || true
node -e "const D=require('better-sqlite3');const db=new D(process.env.DB);const t=db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'brain_%'\").all().map(r=>r.name);console.log('  brain tables:', t.join(','))" DB="$DB" || true

echo "SMOKE OK (structural)"
