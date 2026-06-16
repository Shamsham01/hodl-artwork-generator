/**
 * Legacy API stub — generation now runs in the browser.
 * Kept only for optional health checks during migration; safe to decommission on Render.
 */
const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3001;

const DEFAULT_ORIGINS = [
  "http://localhost:5173",
  "https://hodl-artwork-generator.app",
];

function acceptedOrigins() {
  const fromEnv = (process.env.FRONTEND_URL || "http://localhost:5173")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return [...new Set([...DEFAULT_ORIGINS, ...fromEnv])];
}

app.set("trust proxy", 1);

app.use(
  cors({
    origin(origin, cb) {
      const allowed = acceptedOrigins();
      if (!origin || allowed.some((o) => origin === o || origin.startsWith(o))) {
        cb(null, origin || allowed[0]);
      } else {
        cb(null, allowed[0]);
      }
    },
    credentials: true,
  })
);

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    mode: "browser-generation",
    message: "Render worker decommissioned — compositing runs client-side",
    timestamp: new Date().toISOString(),
  });
});

app.use((_req, res) => {
  res.status(410).json({
    error:
      "This API no longer handles generation. Update the web app to use browser-side rendering.",
  });
});

app.listen(PORT, () => {
  console.log(`Basturds API (stub) on port ${PORT} — browser generation mode`);
});
