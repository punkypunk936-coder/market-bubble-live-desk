#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_FILE="${ROOT_DIR}/market-bubble-live-desk-eb.zip"

cd "${ROOT_DIR}"
rm -f "${OUT_FILE}"

zip -r "${OUT_FILE}" . \
  -x "node_modules/*" \
  -x ".git/*" \
  -x "data/operator-state.json" \
  -x "data/operator-state.json.tmp" \
  -x "screenshot-*.png" \
  -x "market-bubble-live-desk-eb.zip"

echo "Created ${OUT_FILE}"
