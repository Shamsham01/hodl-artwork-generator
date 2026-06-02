# Basturds Studio

Premium NFT art generator for MultiversX creators. Upload layered artwork, define trait compatibility rules, preview combinations, and batch generate unique collections.

## Architecture

- **Frontend** (`apps/web`): Vite + React, deployed to **Netlify** (GitHub auto-deploy, SSL, custom domain)
- **Database** (`supabase/`): Postgres, Storage, Auth, Edge Functions (`mvx-auth`, `verify-generation`)
- **Engine** (`packages/engine-core`, `packages/engine-browser`): Preview + batch generation in the **browser**
- **Cybrancee / Render**: Not required for production (optional Cybrancee only if you want a second host)

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

### Netlify (Frontend — recommended production)

- Connect GitHub repo `hodl-artwork-generator`, branch `main`
- Uses root `netlify.toml` (base directory: **repository root**, not `apps/web`)
- Set `VITE_*` in Netlify → Site settings → Environment variables
- Custom domain: Netlify DNS or your registrar → automatic HTTPS

### Cybrancee (optional)

- Only needed if you want Node hosting outside Netlify; use `npm run package:cybrancee` for a static bundle
- For most users: **skip Cybrancee** and use Netlify instead

### Render (legacy API — decommissioned)

- Generation moved to the browser; cancel Render to save cost

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
