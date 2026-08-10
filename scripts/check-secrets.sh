#!/usr/bin/env bash
# scripts/check-secrets.sh — P0-4 iz docs/bezbednost-i-zastita.md
#
# Traži service_role ključ i sirove JWT-ove u klijentskom bundle-u.
# Jedan slučajan import u "use client" fajlu i cela baza je javna.
#
# Pokreće se posle `pnpm --filter @sajtoskop/web build`, u CI-u i lokalno:
#   pnpm check:secrets

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATIC="$ROOT/apps/web/.next/static"
fail=0

# ── 1. Tajne u izvornom kodu ───────────────────────────────
# NEXT_PUBLIC_ prefiks na tajni bi je svesno ugurao u bundle. Klasa znakova je
# namerno uska ([A-Z0-9_]) — sa `.*` bi se poklopila i bezazlena linija u kojoj
# javna i tajna promenljiva stoje jedna do druge.
if grep -rnE "NEXT_PUBLIC_[A-Z0-9_]*(SERVICE_ROLE|SECRET_KEY|CLERK_SECRET)" \
     --include="*.ts" --include="*.tsx" --include="*.mjs" \
     "$ROOT/apps" "$ROOT/packages" 2>/dev/null; then
  echo "PROBLEM: tajna sa NEXT_PUBLIC_ prefiksom."
  fail=1
fi

# Tajne smeju samo u fajlovima koje Next izvršava na serveru.
for f in $(grep -rlE "SUPABASE_SERVICE_ROLE_KEY|CLERK_SECRET_KEY|CLERK_WEBHOOK_SIGNING_SECRET|ANTHROPIC_API_KEY" \
             --include="*.ts" --include="*.tsx" "$ROOT/apps/web/src" 2>/dev/null); do
  if head -5 "$f" | grep -q '"use client"'; then
    echo "PROBLEM: tajna u \"use client\" fajlu: $f"
    fail=1
  fi
done

# ── 1b. Web ne sme da uvozi worker (F6) ────────────────────
# Prompt, Anthropic klijent i Playwright žive u `apps/worker`. Jedan import odatle
# u web i sve to postaje kandidat za klijentski bundle. Granica je arhitektonska
# (pravilo 7), pa se i proverava kao granica, a ne po posledicama.
if grep -rn "apps/worker\|@sajtoskop/worker" \
     --include="*.ts" --include="*.tsx" "$ROOT/apps/web/src" 2>/dev/null; then
  echo "PROBLEM: apps/web uvozi iz apps/worker."
  fail=1
fi

# ── 2. Tajne u sagrađenom bundle-u ─────────────────────────
if [ ! -d "$STATIC" ]; then
  echo "Preskačem proveru bundle-a: $STATIC ne postoji."
  echo "Pokreni prvo: pnpm --filter @sajtoskop/web build"
else
  # eyJhbGciOi = base64 od {"alg":"  — početak svakog JWT-a, pa i service_role ključa.
  # sk-ant- = Anthropic ključ (F6). Nijedan poziv ka Anthropicu ne ide iz weba,
  # pa ovaj niz u bundle-u znači da je ključ negde procureo kroz import.
  if grep -rl "service_role\|eyJhbGciOi\|sk-ant-" "$STATIC" 2>/dev/null | grep -q .; then
    echo "PROBLEM: service_role, JWT ili Anthropic ključ pronađen u apps/web/.next/static/:"
    grep -rl "service_role\|eyJhbGciOi\|sk-ant-" "$STATIC" 2>/dev/null
    fail=1
  else
    echo "OK: nema service_role, JWT-a ni Anthropic ključa u klijentskom bundle-u."
  fi

  # ── 3. Prompt u bundle-u (F6 §5) ─────────────────────────
  # Doslovno provera iz „Gotovo kad": prompt je intelektualna svojina i deo
  # proizvoda. Ovde stoji njegov početak kao otisak — ako se promeni prva
  # rečenica prompta u `apps/worker/src/lib/ai-audit.ts`, promeni je i ovde.
  if grep -rl "Ti si iskusan srpski" "$STATIC" 2>/dev/null | grep -q .; then
    echo "PROBLEM: Claude prompt pronađen u klijentskom bundle-u:"
    grep -rl "Ti si iskusan srpski" "$STATIC" 2>/dev/null
    fail=1
  else
    echo "OK: nema Claude prompta u klijentskom bundle-u."
  fi
fi

exit "$fail"
