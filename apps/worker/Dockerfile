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
# Od F5 slika sadrži i Chromium (~450MB povrh osnove). Kontejner od tog trenutka
# renderuje nepoznat, potencijalno neprijateljski sadržaj — sva ograničenja u
# `docker-compose.yml` (non-root, read-only, cap_drop ALL) su odatle.

# `bookworm-slim`, ne podrazumevani `slim`: podrazumevani tag je prešao na
# Debian 13, a `playwright install-deps` zna imena apt paketa za Debian 12.
# Na 13 puca sa „unsupported distribution".
FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NODE_ENV=production
# Van $HOME, jer je $HOME u runtime-u /tmp i briše se pri svakom restartu.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
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
# devDependency. Next i Clerk ovako nikad ne dođu na ovu mašinu.
#
# `--prod=false` je namerno: bez `tsx` se TypeScript izvor ne pokreće.
#
# `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD`: postinstall skript paketa `playwright`
# povlači Chromium u $HOME/.cache, koji u sledećem sloju ne postoji. Browser se
# instalira eksplicitno ispod, u /ms-playwright.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN pnpm install --frozen-lockfile --prod=false \
      --filter "@sajtoskop/worker..." \
      --filter "sajtoskop" \
 && pnpm store prune

# ── slika koja se pokreće ──────────────────────────────────
FROM base AS runtime

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/apps/worker/node_modules ./apps/worker/node_modules

# Chromium + sistemske biblioteke koje mu trebaju (fontovi, libnss, libdrm...).
# Verzija browsera je vezana za verziju paketa `playwright`, zato je on u
# package.json prikucan na tačnu verziju bez `^`.
#
# Instalira se kao root, u /ms-playwright van $HOME, sa 0755 — proces pod
# uid 1001 je čita, a `read_only: true` mu brani da je menja.
# Putanja je apps/worker/node_modules, ne koren: pnpm ne diže zavisnosti paketa
# u korenski node_modules, tamo su samo direktne zavisnosti korenskog package.json.
RUN node apps/worker/node_modules/playwright/cli.js install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/worker ./apps/worker

# `workspaceRoot()` u paths.ts traži pnpm-workspace.yaml uz sebe — kopiran je gore.
# `.env` se NE kopira u sliku; stiže kroz `env_file` u compose-u, da ključevi ne
# završe u slojevima slike koji ostaju na disku i posle brisanja kontejnera.

# Ceo fajl sistem je read-only osim /tmp (tmpfs iz compose-a). Chromium hoće da
# piše profil, keš i crash dumpove — bez ovoga launch pukne na EROFS pre nego
# što otvori prvu stranicu.
ENV HOME=/tmp
ENV TMPDIR=/tmp
ENV XDG_CACHE_HOME=/tmp/.cache
ENV XDG_CONFIG_HOME=/tmp/.config

# Ista nenulta uid kao `user:` u docker-compose.yml. Ne `root`, i ne `node`
# (uid 1000) — vlasnik fajlova je root, pa proces nema pravo upisa nigde.
USER 1001:1001

# Bez `pnpm start`: pnpm bi bio PID 1 i progutao SIGTERM, pa bi Docker svaki
# `docker compose down` završavao ubijanjem posle 10s umesto urednim gašenjem.
# Ovako signal stiže Node-u, a `shutdown()` u index.ts odradi svoje.
#
# `--init` u compose-u je od F5 obavezan: Chromium ostavlja zombi procese kad ga
# ubije timeout, a PID 1 koji nije init sistem ih ne žanje.
CMD ["node", "--import", "tsx", "apps/worker/src/index.ts"]
