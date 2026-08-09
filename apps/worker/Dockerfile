# apps/worker/Dockerfile
#
# Kontekst builda je KOREN monorepoa, ne ovaj direktorijum:
#   docker compose -f apps/worker/docker-compose.yml up -d --build
# ili iz korena:
#   docker build -f apps/worker/Dockerfile -t sajtoskop-worker .
#
# Bez build koraka: worker se pokreće kroz `tsx`, isto kao lokalno. Razlog je
# što je jedini artefakt ovog procesa upis u bazu — nema bundlea koji bi neko
# preuzeo, a jedan korak manje je jedan izvor razlike između mog laptopa i
# Hetznera manje.
#
# Playwright NIJE ovde. F3 nema screenshotove (PRD §9); kad stignu u F5, ovaj
# fajl dobija `mcr.microsoft.com/playwright` osnovu i sliku od ~1.5GB.

FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NODE_ENV=production
RUN corepack enable
WORKDIR /app

# ── zavisnosti ─────────────────────────────────────────────
# Samo manifesti prvo: sloj sa `pnpm install` se kešira dok se lockfile ne menja.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# SVI manifesti, uključujući web i cli. Ne zato što nam trebaju, nego zato što
# `--frozen-lockfile` poredi lockfile sa zatečenim workspace-om: ako paket iz
# lockfile-a ovde ne postoji, install pukne na „lockfile is not up to date".
COPY packages/shared/package.json packages/shared/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY apps/cli/package.json apps/cli/

# Filter bira šta se STVARNO instalira: worker sa svojim workspace zavisnostima
# (`...` povlači packages/shared) plus korenski paket, jer je `tsx` njegov
# devDependency. Next, Clerk i Playwright ovako nikad ne dođu na ovu mašinu.
#
# `--prod=false` je namerno: bez `tsx` se TypeScript izvor ne pokreće.
RUN pnpm install --frozen-lockfile --prod=false \
      --filter "@sajtoskop/worker..." \
      --filter "sajtoskop" \
 && pnpm store prune

# ── slika koja se pokreće ──────────────────────────────────
FROM base AS runtime

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/apps/worker/node_modules ./apps/worker/node_modules

COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/worker ./apps/worker

# `workspaceRoot()` u paths.ts traži pnpm-workspace.yaml uz sebe — kopiran je gore.
# `.env` se NE kopira u sliku; stiže kroz `env_file` u compose-u, da ključevi ne
# završe u slojevima slike koji ostaju na disku i posle brisanja kontejnera.

# Ista nenulta uid kao `user:` u docker-compose.yml. Ne `root`, i ne `node`
# (uid 1000) — vlasnik fajlova je root, pa proces nema pravo upisa nigde.
USER 1001:1001

# Bez `pnpm start`: pnpm bi bio PID 1 i progutao SIGTERM, pa bi Docker svaki
# `docker compose down` završavao ubijanjem posle 10s umesto urednim gašenjem.
# Ovako signal stiže Node-u, a `shutdown()` u index.ts odradi svoje.
CMD ["node", "--import", "tsx", "apps/worker/src/index.ts"]
