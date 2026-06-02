/**
 * Pack everything needed for a MANUAL SFTP upload + server-side build.
 * Does NOT include node_modules (run npm install on Cybrancee after upload).
 *
 * Usage: npm run package:cybrancee:full
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "deploy/cybrancee/full");

const COPY_DIRS = ["apps", "packages"];
const COPY_FILES = [
  "package.json",
  "package-lock.json",
  "index.js",
  "web-server.js",
  "server.js",
  "cli.js",
];

const SKIP_DIR_NAMES = new Set(["node_modules", "dist", ".git"]);

function rmDir(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyDirFiltered(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP_DIR_NAMES.has(entry.name)) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirFiltered(from, to);
    else copyFile(from, to);
  }
}

rmDir(OUT);
fs.mkdirSync(OUT, { recursive: true });

for (const f of COPY_FILES) {
  const src = path.join(ROOT, f);
  if (fs.existsSync(src)) copyFile(src, path.join(OUT, f));
}

for (const d of COPY_DIRS) {
  copyDirFiltered(path.join(ROOT, d), path.join(OUT, d));
}

const envSrc = path.join(ROOT, "apps/web/.env");
if (fs.existsSync(envSrc)) {
  copyFile(envSrc, path.join(OUT, ".env"));
}

const instructions = `HODL Artwork Generator — Cybrancee manual upload (full build)
============================================================

Upload EVERYTHING inside this folder to /home/container/ (merge/replace).

Cybrancee Startup settings:
  Bot JS File: index.js
  NPM Install: ON
  AUTO UPDATE: OFF  (git pull does nothing without a .git folder)
  USER UPLOADED FILES: OFF
  Git repo: can leave blank or ignore

After upload, add /home/container/.env with VITE_* vars (see apps/web/.env on your PC).

In Cybrancee Variables OR .env file:
  BUILD_ON_START=true
  VITE_SUPABASE_URL=...
  VITE_SUPABASE_ANON_KEY=...
  VITE_MVX_ENV=mainnet
  VITE_WALLETCONNECT_V2_PROJECT_ID=...
  NODE_OPTIONS=--max-old-space-size=1536

Delete core.* crash dump files if present before restart.

First start: npm install + vite build takes ~5-15 minutes.
`;

fs.writeFileSync(path.join(OUT, "UPLOAD.txt"), instructions);

console.log("Packed:", OUT);
console.log(instructions);
