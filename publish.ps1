# One-command deploy: build on PC -> pull on server -> upload dist -> deploy
# Usage (from repo root):
#   .\publish.ps1           # after Commit & Push in Cursor
#   .\publish.ps1 -Push     # git push, then deploy
#
# Optional env:
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

$mainJs = Select-String -Path "$Root\frontend\dist\asset-manifest.json" -Pattern 'static/js/main\.[a-f0-9]+\.js' | Select-Object -First 1
if ($mainJs) { Write-Host "    Built: $($mainJs.Matches.Value)" }

Write-Host "==> Server: git pull"
ssh $SshHost "cd $RemoteApp && git checkout -- core/__pycache__ core/templatetags/__pycache__ 2>/dev/null || true && git pull --ff-only"

Write-Host "==> Upload frontend/dist"
scp -r "$Root\frontend\dist" "${SshHost}:${RemoteApp}/frontend/"

Write-Host "==> Server: deploy (collectstatic, etc.)"
ssh $SshHost "cd $RemoteApp && SKIP_FRONTEND_BUILD=1 bash deploy.sh"

Write-Host "==> Server: restart gunicorn (interactive sudo — enter password if asked)"
ssh -t $SshHost "sudo systemctl restart gunicorn-ur-model && echo '==> Restarted OK'"

Write-Host "==> Publish complete — hard refresh https://ur.146-190-82-105.nip.io/ (Ctrl+Shift+R)"
