/**
 * Production static server for Cybrancee (or any Node host).
 *
 * Cybrancee panel:
 *   Bot JS File: server.js
 *   NPM Install: ON
 *   Docker Image: NodeJS 20 or 22
 *
 * Set VITE_* env vars in the Cybrancee Variables panel before start — they are
 * read during the Vite build step below.
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const express = require("express");

const ROOT = __dirname;
const DIST = path.join(ROOT, "apps/web/dist");
const INDEX = path.join(DIST, "index.html");

function listenPort() {
  const raw =
    process.env.PORT ||
    process.env.SERVER_PORT ||
    process.env.PTERODACTYL_PORT ||
    "8080";
  const port = parseInt(raw, 10);
  return Number.isFinite(port) ? port : 8080;
}

function shouldBuild() {
  if (process.env.BUILD_ON_START === "true" || process.env.BUILD_ON_START === "1") {
    return true;
  }
  if (process.env.BUILD_ON_START === "false" || process.env.BUILD_ON_START === "0") {
    return false;
  }
  return !fs.existsSync(INDEX);
}

function runBuild() {
  console.log("[hodl] Building web app (npm run build:web)...");
  const required = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    console.warn(
      `[hodl] Warning: missing env vars for Vite build: ${missing.join(", ")}`
    );
  }

  execSync("npm run build:web", {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "production" },
  });
  console.log("[hodl] Build complete.");
}

function createApp() {
  if (!fs.existsSync(INDEX)) {
    throw new Error(
      `Missing ${INDEX}. Set BUILD_ON_START=true or run npm run build:web first.`
    );
  }

  const app = express();

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      mode: "static-spa",
      dist: DIST,
      timestamp: new Date().toISOString(),
    });
  });

  app.use(
    express.static(DIST, {
      index: "index.html",
      maxAge: process.env.NODE_ENV === "production" ? "1h" : 0,
    })
  );

  // SPA fallback — /studio/:id etc.
  app.get(/.*/, (_req, res) => {
    res.sendFile(INDEX);
  });

  return app;
}

(function main() {
  if (shouldBuild()) {
    runBuild();
  } else {
    console.log("[hodl] Skipping build (dist present, BUILD_ON_START not set).");
  }

  const port = listenPort();
  const app = createApp();

  app.listen(port, "0.0.0.0", () => {
    console.log(`[hodl] Serving ${DIST} on http://0.0.0.0:${port}`);
  });
})();
