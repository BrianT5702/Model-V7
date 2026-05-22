# One-command deploy: build on PC -> pull on server -> upload dist -> deploy
# Usage (from repo root):
#   .\publish.ps1           # after Commit & Push in Cursor
#   .\publish.ps1 -Push     # git push, then deploy

param(
    [switch]$Push,
    [string]$SshHost = $(if ($env:DEPLOY_SSH) { $env:DEPLOY_SSH } else { "brian@146.190.82.105" }),
    [string]$RemoteApp = $(if ($env:DEPLOY_APP) { $env:DEPLOY_APP } else { "~/ur-model/app" }),
    [string]$SiteUrl = $(if ($env:DEPLOY_URL) { $env:DEPLOY_URL } else { "https://ur.146-190-82-105.nip.io" })
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

$mainJsMatch = Select-String -Path "$Root\frontend\dist\asset-manifest.json" -Pattern 'static/js/main\.[a-f0-9]+\.js' | Select-Object -First 1
$mainJsPath = if ($mainJsMatch) { $mainJsMatch.Matches.Value } else { $null }
if ($mainJsPath) { Write-Host "    Built: $mainJsPath" }

Write-Host "==> Server: git pull"
ssh $SshHost "cd $RemoteApp && git checkout -- core/__pycache__ core/templatetags/__pycache__ 2>/dev/null || true && git pull --ff-only"

Write-Host "==> Upload frontend/dist"
scp -r "$Root\frontend\dist" "${SshHost}:${RemoteApp}/frontend/"

Write-Host "==> Server: deploy + restart (one SSH session - enter passphrase/password when asked)"
$remote = "cd $RemoteApp && SKIP_FRONTEND_BUILD=1 bash deploy.sh && sudo systemctl restart gunicorn-ur-model && ls -1 staticfiles/js/main.*.js | head -1"
ssh -t $SshHost $remote
if ($LASTEXITCODE -ne 0) {
    throw "Remote deploy/restart failed (exit $LASTEXITCODE). SSH to server and run: cd $RemoteApp && SKIP_FRONTEND_BUILD=1 bash deploy.sh && sudo systemctl restart gunicorn-ur-model"
}

if ($mainJsPath) {
    $checkUrl = "$SiteUrl/$mainJsPath"
    Write-Host "==> Verify: $checkUrl"
    try {
        $resp = Invoke-WebRequest -Uri $checkUrl -Method Head -UseBasicParsing -TimeoutSec 30
        $ct = $resp.Headers['Content-Type']
        Write-Host "    HTTP $($resp.StatusCode) Content-Type: $ct"
        if ($ct -like '*html*') {
            throw "Site still returns HTML for JS (static files not fixed). See server fix below."
        }
    } catch {
        Write-Warning "Could not verify URL ($checkUrl): $_"
        Write-Warning "On server run: ls ~/ur-model/app/staticfiles/js/main.*.js"
    }
}

Write-Host "==> Publish complete - hard refresh $SiteUrl (Ctrl+Shift+R)"
