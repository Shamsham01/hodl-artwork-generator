#!/bin/bash
# Run ONCE in Cybrancee console (server can be running or stopped):
#   cd /home/container
#   bash cybrancee-git-bootstrap.sh
#
# Creates a real .git/ directory linked to GitHub so AUTO UPDATE (git pull) works.
# You cannot upload ".git" as a single file from Windows — it is a folder with thousands of entries.

set -euo pipefail

REPO="${GIT_REPO:-https://github.com/Shamsham01/hodl-artwork-generator.git}"
BRANCH="${GIT_BRANCH:-main}"
ROOT="/home/container"

cd "$ROOT"

echo "[hodl] Backing up .env if present..."
ENV_BACKUP=""
if [ -f .env ]; then
  ENV_BACKUP="$(mktemp)"
  cp .env "$ENV_BACKUP"
fi

if [ -d .git ]; then
  echo "[hodl] .git already exists — fetching latest $BRANCH..."
  git remote set-url origin "$REPO" 2>/dev/null || git remote add origin "$REPO"
  git fetch --depth 1 origin "$BRANCH"
  git checkout -B "$BRANCH" "origin/$BRANCH" -f
  git reset --hard "origin/$BRANCH"
else
  echo "[hodl] No .git found — shallow clone of $BRANCH (this replaces tracked project files)..."
  # Keep bootstrap script and .env while clearing everything else
  shopt -s dotglob nullglob
  for item in *; do
    case "$item" in
      .env | cybrancee-git-bootstrap.sh) ;;
      *) rm -rf "$item" ;;
    esac
  done
  for item in .[!.]* ..?*; do
    case "$item" in
      .env) ;;
      *) rm -rf "$item" ;;
    esac
  done
  git clone --depth 1 --branch "$BRANCH" "$REPO" .
fi

if [ -n "$ENV_BACKUP" ] && [ -f "$ENV_BACKUP" ]; then
  cp "$ENV_BACKUP" .env
  rm -f "$ENV_BACKUP"
  echo "[hodl] Restored .env"
fi

echo "[hodl] Done. Git status:"
git rev-parse --short HEAD
git remote -v
echo ""
echo "Cybrancee Startup settings:"
echo "  AUTO UPDATE: ON"
echo "  GIT REPO ADDRESS: $REPO"
echo "  INSTALL BRANCH: $BRANCH"
echo "  BOT JS FILE: index.js"
echo "  NPM Install: ON"
echo ""
echo "For full-repo deploy also set in .env or panel variables:"
echo "  BUILD_ON_START=true"
echo "  VITE_SUPABASE_URL=..."
echo "  VITE_SUPABASE_ANON_KEY=..."
echo "  (and other VITE_* from apps/web/.env)"
echo ""
echo "For pre-built deploy (no server build), use npm run package:cybrancee locally instead of git pull."
