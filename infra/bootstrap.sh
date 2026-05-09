#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Helixiri Browser Platform — VPS Bootstrap
# ============================================================

echo "==> [bootstrap] Starting Helixiri Browser Platform setup"

# ------------------------------------------------------------
# 1. Must run as root or via sudo
# ------------------------------------------------------------
if [[ "$EUID" -ne 0 ]]; then
  echo "ERROR: This script must be run as root or via sudo."
  echo "       Run: sudo bash infra/bootstrap.sh"
  exit 1
fi

INVOKING_USER="${SUDO_USER:-$USER}"
echo "==> [bootstrap] Invoking user: ${INVOKING_USER}"

# ------------------------------------------------------------
# 2. Install apt dependencies
# ------------------------------------------------------------
echo "==> [bootstrap] Installing apt dependencies (ca-certificates curl gnupg git)"
apt update -qq
apt install -y ca-certificates curl gnupg git

# ------------------------------------------------------------
# 3. Install Docker if not present
# ------------------------------------------------------------
if docker --version &>/dev/null; then
  echo "==> [bootstrap] Docker already installed: $(docker --version)"
else
  echo "==> [bootstrap] Installing Docker via official convenience script"
  curl -fsSL https://get.docker.com | sh
fi

# ------------------------------------------------------------
# 4. Enable and start Docker service
# ------------------------------------------------------------
echo "==> [bootstrap] Enabling and starting Docker service"
systemctl enable --now docker

# ------------------------------------------------------------
# 5. Add invoking user to docker group
# ------------------------------------------------------------
if id -nG "${INVOKING_USER}" | grep -qw docker; then
  echo "==> [bootstrap] User '${INVOKING_USER}' is already in the docker group"
else
  echo "==> [bootstrap] Adding '${INVOKING_USER}' to the docker group"
  usermod -aG docker "${INVOKING_USER}"
  echo "    NOTE: Log out and back in for this to take effect."
fi

# ------------------------------------------------------------
# 6. Create .env if it does not exist
# ------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ ! -f "${SCRIPT_DIR}/.env" ]]; then
  cp "${SCRIPT_DIR}/.env.example" "${SCRIPT_DIR}/.env"
  echo "==> [bootstrap] Created ${SCRIPT_DIR}/.env from .env.example"
  echo "    IMPORTANT: Edit .env before starting the stack."
else
  echo "==> [bootstrap] .env already exists — skipping copy"
fi

# ------------------------------------------------------------
# 7. Create profile and extension volume directories
# ------------------------------------------------------------
echo "==> [bootstrap] Creating volume directories"
mkdir -p /data/browser-profiles /data/browser-extensions
chmod 755 /data/browser-profiles /data/browser-extensions
echo "    /data/browser-profiles  (Chrome profile persistence)"
echo "    /data/browser-extensions (shared extension directory)"

# ------------------------------------------------------------
# Done
# ------------------------------------------------------------
echo ""
echo "==> [bootstrap] Setup complete."
echo ""
echo "Next steps:"
echo ""
echo "  Path A — Custom domain + HTTPS (recommended for production):"
echo "    1. Edit infra/.env  — set DOMAIN, AUTH_USER, AUTH_PASS_HASH"
echo "    2. Log out and back in (docker group)"
echo "    3. cd infra && docker compose up -d"
echo ""
echo "  Path B — Localhost only (faster, access via SSH tunnel):"
echo "    1. Log out and back in (docker group)"
echo "    2. cd infra && docker compose -f docker-compose.localhost.yml up -d"
echo ""
echo "  See 02a-PATH-A-CLOUDFLARE.md or 02b-PATH-B-LOCALHOST.md for details."
