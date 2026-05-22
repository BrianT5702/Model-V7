#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${ENV_FILE:-/etc/ur-model.env}"
SERVICE_NAME="${SERVICE_NAME:-gunicorn-ur-model}"
GUNICORN_USER="${GUNICORN_USER:-urmodel}"

echo "==> Deploy start"
cd "$APP_DIR"

if [[ -d .git ]]; then
    if [[ "${SKIP_FRONTEND_BUILD:-0}" == "1" ]]; then
        echo "==> Skip git pull (publish.ps1 already pulled; dist uploaded separately)"
    else
        echo "==> Pull latest code"
        if git ls-files '*.pyc' >/dev/null 2>&1; then
            git ls-files '*.pyc' | while read -r f; do
                git checkout -- "$f" 2>/dev/null || true
            done
        fi
        if git ls-files 'frontend/dist' >/dev/null 2>&1; then
            git ls-files 'frontend/dist' | while read -r f; do
                git checkout -- "$f" 2>/dev/null || true
            done
        fi
        git checkout -- frontend/build deploy.sh 2>/dev/null || true
        git pull --ff-only
    fi
else
    echo "WARN: Not a git repository — skipping git pull"
fi

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

echo "==> Frontend (output: frontend/$FRONTEND_BUILD_DIR)"
pushd frontend >/dev/null
if [[ -d node_modules ]] && [[ ! -w node_modules ]]; then
    echo "ERROR: frontend/node_modules is not writable by $(whoami)."
    echo "  sudo rm -rf $APP_DIR/frontend/node_modules"
    exit 1
fi
# SKIP_FRONTEND_BUILD=1: dist uploaded from PC (see publish.ps1). Avoids OOM on small VPS.
if [[ "${SKIP_FRONTEND_BUILD:-0}" == "1" ]]; then
    if [[ ! -f "$FRONTEND_BUILD_DIR/asset-manifest.json" ]]; then
        echo "ERROR: SKIP_FRONTEND_BUILD=1 but frontend/$FRONTEND_BUILD_DIR is missing."
        echo "  On your PC run: .\\publish.ps1"
        exit 1
    fi
    echo "    Using uploaded frontend/$FRONTEND_BUILD_DIR (no npm build)"
else
    npm ci
    rm -rf "$FRONTEND_BUILD_DIR"
    export GENERATE_SOURCEMAP=false
    export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=2048}"
    BUILD_PATH="$FRONTEND_BUILD_DIR" npm run build
fi
popd >/dev/null

echo "==> Run migrations"
./venv/bin/python manage.py migrate --settings=model_builder.settings_production

echo "==> Collect static files"
# staticfiles/ may be owned by urmodel from a prior deploy; brian must be able to clear it
if [[ -d "$APP_DIR/staticfiles" ]]; then
    sudo chown -R "$(whoami):$(whoami)" "$APP_DIR/staticfiles" 2>/dev/null || true
fi
./venv/bin/python manage.py collectstatic --noinput --clear --settings=model_builder.settings_production

echo "==> Verify frontend build matches asset manifest"
MANIFEST="$APP_DIR/frontend/$FRONTEND_BUILD_DIR/asset-manifest.json"
if [[ ! -f "$MANIFEST" ]]; then
    echo "ERROR: Missing $MANIFEST — frontend build did not complete."
    exit 1
fi
MAIN_JS=$(grep -oE 'static/js/main\.[a-f0-9]+\.js' "$MANIFEST" | head -1)
if [[ -n "$MAIN_JS" ]]; then
    if [[ ! -f "$APP_DIR/frontend/$FRONTEND_BUILD_DIR/$MAIN_JS" ]]; then
        echo "ERROR: Manifest references $MAIN_JS but file is missing in frontend/$FRONTEND_BUILD_DIR."
        exit 1
    fi
    # After collectstatic, file must be at staticfiles/js/... (not staticfiles/static/js/)
    COLLECTED_JS="${MAIN_JS#static/}"
    if [[ ! -f "$APP_DIR/staticfiles/$COLLECTED_JS" ]]; then
        echo "ERROR: collectstatic did not place $COLLECTED_JS at staticfiles/$COLLECTED_JS"
        exit 1
    fi
    echo "    OK: $MAIN_JS -> staticfiles/$COLLECTED_JS"
fi

# Gunicorn runs as urmodel; dist must be readable by urmodel AND deploy user (brian)
if [[ -d "$APP_DIR/frontend/$FRONTEND_BUILD_DIR" ]]; then
    echo "==> Fix permissions on frontend/$FRONTEND_BUILD_DIR for $GUNICORN_USER"
    sudo chown -R "$GUNICORN_USER:$GUNICORN_USER" "$APP_DIR/frontend/$FRONTEND_BUILD_DIR" 2>/dev/null || true
    sudo chmod -R 755 "$APP_DIR/frontend/$FRONTEND_BUILD_DIR" 2>/dev/null || chmod -R 755 "$APP_DIR/frontend/$FRONTEND_BUILD_DIR"
fi
if [[ -d "$APP_DIR/staticfiles" ]]; then
    sudo chown -R "$GUNICORN_USER:$GUNICORN_USER" "$APP_DIR/staticfiles" 2>/dev/null || true
    sudo chmod -R 755 "$APP_DIR/staticfiles" 2>/dev/null || chmod -R 755 "$APP_DIR/staticfiles"
fi

echo "==> Deploy build complete"
echo "    Restart app: sudo systemctl restart $SERVICE_NAME"
echo "    Frontend build: $APP_DIR/frontend/$FRONTEND_BUILD_DIR"
if [[ -d "$APP_DIR/frontend/build" ]]; then
    echo "WARN: Old frontend/build still exists (may be root-owned). Safe to remove when convenient:"
    echo "  sudo rm -rf $APP_DIR/frontend/build"
fi
