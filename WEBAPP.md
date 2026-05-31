# Basturds Studio

Premium NFT art generator for MultiversX creators. Upload layered artwork, define trait compatibility rules, preview combinations, and batch generate unique collections.

## Architecture

- **Frontend** (`apps/web`): Vite + React, deployed to Netlify
- **API** (`apps/api`): Express + canvas engine, deployed to Render
- **Database** (`supabase/`): Postgres, Storage, Auth, Edge Functions
- **Engine** (`packages/engine`): Extracted HashLips generation logic

## Quick Start

### 1. Install dependencies

```bash
npm install
cd apps/web && npm install --legacy-peer-deps
cd ../api && npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Fill in Supabase, MVX, and API URLs
```

### 3. Run Supabase locally (optional)

```bash
supabase start
supabase db reset
supabase functions serve mvx-auth
```

### 4. Start development servers

```bash
# Terminal 1: API
npm run dev:api

# Terminal 2: Web
npm run dev:web
```

### 5. CLI generation (unchanged)

```bash
npm run generate
```

## Deployment

### Netlify (Frontend)

- Base directory: `apps/web`
- Build command: `npm install --legacy-peer-deps && npm run build`
- Publish directory: `dist`
- Set `VITE_*` environment variables

### Render (API)

- Use `apps/api/render.yaml` or Docker
- Set `SUPABASE_*`, `FRONTEND_URL`, `PORT` env vars
- Requires Node 20 with native canvas dependencies

### Supabase

```bash
supabase link --project-ref your-ref
supabase db push
supabase functions deploy mvx-auth
```

## Wallet Login

Uses MultiversX sdk-dapp 5.x with Native Auth. Connect wallet in the app, token is validated by the `mvx-auth` Edge Function, and a Supabase session is issued.

Reference: [mvx-websocket-dapp](https://github.com/Shamsham01/mvx-websocket-dapp/tree/main/frontend)

## Trait Restrictions

Same logic as the original CLI engine:

- **excludeLayers**: Hide entire layers when a trigger trait is selected
- **excludeElements**: Re-roll specific traits when combinations conflict

Configure rules in the Studio "Rules" tab.
