#!/usr/bin/env bash
# Run from project root to install the systemd service.
set -euo pipefail

PROJECT_ROOT="$(pwd)"
UNIT_NAME="akiflow-sync"
UNIT_SRC="${PROJECT_ROOT}/akiflow-sync/akiflow-sync.service"
SYSTEMD_DIR="${HOME}/.config/systemd/user"
LOG_DIR="${PROJECT_ROOT}/akiflow"

NODE_BIN="$(which node)"
NPM_BIN="$(which npm)"

mkdir -p "${LOG_DIR}"
mkdir -p "${SYSTEMD_DIR}"

echo "Building akiflow-sync..."
"${NPM_BIN}" run build --prefix "${PROJECT_ROOT}/akiflow-sync"

# Substitute the project root and binary paths into the unit file before installing
sed \
  -e "s|%PROJECT_ROOT%|${PROJECT_ROOT}|g" \
  -e "s|%NODE_BIN%|${NODE_BIN}|g" \
  "${UNIT_SRC}" > "${SYSTEMD_DIR}/${UNIT_NAME}.service"

systemctl --user daemon-reload
systemctl --user enable "${UNIT_NAME}"
systemctl --user start "${UNIT_NAME}"

echo "akiflow-sync service installed and started."
echo "Logs: tail -f ${LOG_DIR}/akiflow-sync.log"
