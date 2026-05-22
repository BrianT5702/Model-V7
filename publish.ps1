# One-command deploy: build on PC -> upload dist -> pull + deploy on server
# Usage (from repo root):
#   .\publish.ps1           # deploy (code must already be pushed)
#   .\publish.ps1 -Push     # git push, then deploy
#
# Optional env (or edit defaults below):
#   $env:DEPLOY_SSH = "brian@146.190.82.105"
#   $env:DEPLOY_APP  = "~/ur-model/app"

param(
    [switch]$Push,
    [string]$SshHost = $(if ($env:DEPLOY_SSH) { $env:DEPLOY_SSH } else { "brian@146.190.82.105" }),
    [string]$RemoteApp = $(if ($env:DEPLOY_APP) { $env:DEPLOY_APP } else { "~/ur-model/app" })
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot

Set-Location $Root

if ($Push) {
    Write-Host "==> git push"
    git push
}

Write-Host "==> Build frontend (dist)"
Set-Location "$Root\frontend"
$env:BUILD_PATH = "dist"
$env:GENERATE_SOURCEMAP = "false"
npm run build
Set-Location $Root

if (-not (Test-Path "$Root\frontend\dist\asset-manifest.json")) {
    throw "Build failed: frontend\dist\asset-manifest.json missing"
}

Write-Host "==> Upload frontend/dist to $SshHost"
scp -r "$Root\frontend\dist" "${SshHost}:${RemoteApp}/frontend/"

Write-Host "==> Server: pull + deploy + restart"
$remote = @"
set -e
cd $RemoteApp
git checkout -- core/__pycache__ core/templatetags/__pycache__ 2>/dev/null || true
git pull --ff-only
SKIP_FRONTEND_BUILD=1 bash deploy.sh
sudo systemctl restart gunicorn-ur-model
echo '==> Done: https://ur.146-190-82-105.nip.io/'
"@ -replace "`r`n", "`n"

ssh $SshHost $remote

Write-Host "==> Publish complete"
