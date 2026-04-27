#!/usr/bin/env bash
# ============================================================
#  campro — Local Quick Start
#  Run: bash setup.sh
# ============================================================
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo ""
echo "🛡️  campro — Local Setup"
echo "────────────────────────────────────────"

# ── 1. Node version check ─────────────────────────────────────
NODE_VER=$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1)
if [ -z "$NODE_VER" ] || [ "$NODE_VER" -lt 18 ]; then
  echo -e "${RED}✗ Node.js 18+ is required. Install from https://nodejs.org${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Node.js $(node -v)${NC}"

# ── 2. Install dependencies ───────────────────────────────────
echo ""
echo "📦 Installing npm dependencies…"
npm install
echo -e "${GREEN}✓ Dependencies installed${NC}"

# ── 3. .env setup ────────────────────────────────────────────
if [ ! -f ".env" ]; then
  cp .env.example .env
  echo ""
  echo -e "${YELLOW}⚠  .env file created from .env.example${NC}"
  echo "   Open .env and fill in your API keys before running."
else
  echo -e "${GREEN}✓ .env file already exists${NC}"
fi

# ── 4. face-api.js models ────────────────────────────────────
MODELS_DIR="public/models"
if [ ! -d "$MODELS_DIR" ] || [ -z "$(ls -A $MODELS_DIR 2>/dev/null)" ]; then
  echo ""
  echo "📥 Downloading face-api.js models…"
  mkdir -p "$MODELS_DIR"
  BASE="https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights"
  FILES=(
    "tiny_face_detector_model-weights_manifest.json"
    "tiny_face_detector_model-shard1"
    "face_landmark_68_model-weights_manifest.json"
    "face_landmark_68_model-shard1"
  )
  for f in "${FILES[@]}"; do
    curl -sSL "$BASE/$f" -o "$MODELS_DIR/$f"
    echo "  ↓ $f"
  done
  echo -e "${GREEN}✓ Models downloaded to $MODELS_DIR${NC}"
else
  echo -e "${GREEN}✓ face-api.js models already present${NC}"
fi

# ── 5. Done ──────────────────────────────────────────────────
echo ""
echo "────────────────────────────────────────"
echo -e "${GREEN}✅ Setup complete!${NC}"
echo ""
echo "  Start dev server:   npm run dev"
echo "  Start prod server:  npm start"
echo ""
echo "  App  → http://localhost:3000"
echo "  Dashboard → http://localhost:3000/dashboard.html"
echo "  Health    → http://localhost:3000/health"
echo ""
