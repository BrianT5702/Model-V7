#!/usr/bin/env bash
# Run ON THE SERVER if static JS/CSS still 404 after deploy.
# Usage: cd ~/ur-model/app && bash scripts/fix-static-on-server.sh
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"

echo "==> Pull latest (includes settings_production static path fix)"
git checkout -- core/__pycache__ core/templatetags/__pycache__ 2>/dev/null || true
git pull --ff-only

echo "==> collectstatic"
./venv/bin/python manage.py collectstatic --noinput --clear --settings=model_builder.settings_production

echo "==> Check files exist at staticfiles/js/ (NOT staticfiles/static/js/)"
ls -la staticfiles/js/main.*.js || {
    echo "ERROR: No main.*.js in staticfiles/js/"
    echo "If you see files under staticfiles/static/js/ the old layout is still in use."
    exit 1
}

echo "==> Restart gunicorn"
sudo systemctl restart gunicorn-ur-model

MAIN=$(ls staticfiles/js/main.*.js | head -1 | xargs basename)
echo "==> Test (run from server):"
echo "  curl -I https://ur.146-190-82-105.nip.io/static/js/$MAIN"
