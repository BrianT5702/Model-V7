#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${ENV_FILE:-/etc/ur-model.env}"
SERVICE_NAME="${SERVICE_NAME:-gunicorn-ur-model}"

echo "==> Deploy start"
cd "$APP_DIR"

if [[ ! -f "manage.py" ]]; then
    echo "ERROR: manage.py not found in $APP_DIR"
    exit 1
fi

if [[ ! -x "./venv/bin/python" ]]; then
    echo "ERROR: venv missing at $APP_DIR/venv. Create it first:"
    echo "  python3.12 -m venv venv"
    exit 1
fi

if [[ -f "$ENV_FILE" ]]; then
    set -a
    # shellcheck disable=SC1090
    . "$ENV_FILE"
    set +a
else
    echo "WARN: Env file not found at $ENV_FILE. Continuing with current shell env."
fi

# Use dist/ for production builds so a root-owned frontend/build/ cannot block deploy
export FRONTEND_BUILD_DIR="${FRONTEND_BUILD_DIR:-dist}"

echo "==> Install Python dependencies"
./venv/bin/pip install -r requirements.txt

echo "==> Build frontend (output: frontend/$FRONTEND_BUILD_DIR)"
pushd frontend >/dev/null
if [[ -d node_modules ]] && [[ ! -w node_modules ]]; then
    echo "ERROR: frontend/node_modules is not writable by $(whoami)."
    echo "  sudo rm -rf $APP_DIR/frontend/node_modules"
    exit 1
fi
npm ci
rm -rf "$FRONTEND_BUILD_DIR"
BUILD_PATH="$FRONTEND_BUILD_DIR" npm run build
popd >/dev/null

echo "==> Run migrations"
./venv/bin/python manage.py migrate --settings=model_builder.settings_production

echo "==> Collect static files"
./venv/bin/python manage.py collectstatic --noinput --settings=model_builder.settings_production

echo "==> Deploy build complete (restart service separately as sudo user)"
echo "    Frontend build: $APP_DIR/frontend/$FRONTEND_BUILD_DIR"
if [[ -d "$APP_DIR/frontend/build" ]]; then
    echo "WARN: Old frontend/build still exists (may be root-owned). Safe to remove when convenient:"
    echo "  sudo rm -rf $APP_DIR/frontend/build"
fi
