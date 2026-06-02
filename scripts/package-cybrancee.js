/**
 * Build the SPA locally and pack a minimal Cybrancee bundle (~few MB + dist).
 * Upload everything inside deploy/cybrancee/out/ to /home/container/ via SFTP.
 *
 * Usage: npm run package:cybrancee
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "deploy/cybrancee/out");

const MINIMAL_PACKAGE = {
  name: "hodl-artwork-host",
  private: true,
  description: "Minimal static host for Cybrancee (express only)",
  main: "index.js",
  scripts: {
    start: "node index.js",
  },
  dependencies: {
    express: "^4.21.2",
  },
};

function rmDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    throw new Error(`Missing ${src}`);
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(from, to);
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

console.log("[package:cybrancee] Building web app locally...");
execSync("npm run build:web", {
  cwd: ROOT,
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "production" },
});

const distSrc = path.join(ROOT, "apps/web/dist");
const indexHtml = path.join(distSrc, "index.html");
if (!fs.existsSync(indexHtml)) {
  throw new Error("Build failed: apps/web/dist/index.html not found");
}

console.log("[package:cybrancee] Packing minimal bundle...");
rmDir(OUT);
fs.mkdirSync(OUT, { recursive: true });

copyFile(path.join(ROOT, "index.js"), path.join(OUT, "index.js"));
copyFile(path.join(ROOT, "web-server.js"), path.join(OUT, "web-server.js"));
copyFile(
  path.join(ROOT, "scripts/cybrancee-git-bootstrap.sh"),
  path.join(OUT, "cybrancee-git-bootstrap.sh")
);
copyDir(distSrc, path.join(OUT, "apps/web/dist"));
fs.writeFileSync(
  path.join(OUT, "package.json"),
  JSON.stringify(MINIMAL_PACKAGE, null, 2) + "\n"
);

const sizeMb = (dir) => {
  let bytes = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else bytes += fs.statSync(p).size;
    }
  };
  walk(dir);
  return (bytes / 1024 / 1024).toFixed(1);
};

console.log("");
console.log("Done:", OUT);
console.log("Size:", sizeMb(OUT), "MB");
console.log("");
console.log("Upload ALL contents of deploy/cybrancee/out/ to /home/container/");
console.log("");
console.log("Cybrancee settings for MANUAL upload (recommended):");
console.log("  Bot JS File: index.js");
console.log("  NPM Install: ON");
console.log("  AUTO UPDATE: OFF     <- git pull only works if .git exists on server");
console.log("  USER UPLOADED FILES: OFF");
console.log("  BUILD_ON_START: false");
console.log("  (VITE_* vars already baked into dist — no .env needed on server)");
console.log("");
console.log("For server-side build instead, run: npm run package:cybrancee:full");
console.log("");
