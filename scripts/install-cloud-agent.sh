#!/usr/bin/env bash
set -euo pipefail

LIGHTOPS_USER="${LIGHTOPS_USER:-lightops}"
INSTALL_DIR="${INSTALL_DIR:-/opt/lightops/agent}"
DATA_DIR="${DATA_DIR:-/var/lib/lightops}"
SERVICE_FILE="/etc/systemd/system/lightops-cloud-agent.service"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run as root: sudo bash scripts/install-cloud-agent.sh"
  exit 1
fi

echo "[LightOps] Installing Cloud Agent"

if ! command -v node >/dev/null 2>&1; then
  echo "[LightOps] Node.js is required. Install Node.js 20+ first."
  exit 1
fi

if ! id "${LIGHTOPS_USER}" >/dev/null 2>&1; then
  useradd --system --create-home --shell /usr/sbin/nologin "${LIGHTOPS_USER}"
fi

mkdir -p "${INSTALL_DIR}" "${DATA_DIR}"
chown -R "${LIGHTOPS_USER}:${LIGHTOPS_USER}" "${DATA_DIR}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

rsync -a --delete \
  --exclude ".git" \
  --exclude ".lightops" \
  --exclude "node_modules" \
  "${REPO_ROOT}/" "${INSTALL_DIR}/"

cp "${REPO_ROOT}/deploy/systemd/lightops-cloud-agent.service" "${SERVICE_FILE}"
chown -R "${LIGHTOPS_USER}:${LIGHTOPS_USER}" "${INSTALL_DIR}"

systemctl daemon-reload
systemctl enable lightops-cloud-agent
systemctl restart lightops-cloud-agent
ln -sf "${INSTALL_DIR}/bin/lightops" /usr/local/bin/lightops

echo "[LightOps] Cloud Agent installed."
echo "[LightOps] Local URL: http://127.0.0.1:3717"
echo "[LightOps] TUI command: lightops"
echo "[LightOps] SSH tunnel: ssh -L 3717:127.0.0.1:3717 <user>@<server-ip>"
