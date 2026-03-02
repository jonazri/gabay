#!/usr/bin/env bash
# Run from project root to install the systemd service.
set -euo pipefail

UNIT_NAME="akiflow-sync"
UNIT_SRC="$(pwd)/akiflow-sync/akiflow-sync.service"
SYSTEMD_DIR="${HOME}/.config/systemd/user"

mkdir -p "${HOME}/code/yonibot/gabay/akiflow"
mkdir -p "${SYSTEMD_DIR}"
cp "${UNIT_SRC}" "${SYSTEMD_DIR}/${UNIT_NAME}.service"

systemctl --user daemon-reload
systemctl --user enable "${UNIT_NAME}"
systemctl --user start "${UNIT_NAME}"

echo "akiflow-sync service installed and started."
echo "Logs: tail -f ~/code/yonibot/gabay/akiflow/akiflow-sync.log"
