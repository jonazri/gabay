#!/usr/bin/env bash
# Run from project root to install the systemd service.
set -euo pipefail

PROJECT_ROOT="$(pwd)"
UNIT_NAME="akiflow-sync"
UNIT_SRC="${PROJECT_ROOT}/akiflow-sync/akiflow-sync.service"
SYSTEMD_DIR="${HOME}/.config/systemd/user"
LOG_DIR="${PROJECT_ROOT}/akiflow"

mkdir -p "${LOG_DIR}"
mkdir -p "${SYSTEMD_DIR}"

# Substitute the project root into the unit file before installing
sed "s|%PROJECT_ROOT%|${PROJECT_ROOT}|g" "${UNIT_SRC}" \
  > "${SYSTEMD_DIR}/${UNIT_NAME}.service"

systemctl --user daemon-reload
systemctl --user enable "${UNIT_NAME}"
systemctl --user start "${UNIT_NAME}"

echo "akiflow-sync service installed and started."
echo "Logs: tail -f ${LOG_DIR}/akiflow-sync.log"
