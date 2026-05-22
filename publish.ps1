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
$SshBase = @("-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3")

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
& ssh @SshBase $SshHost "cd $RemoteApp && git checkout -- core/__pycache__ core/templatetags/__pycache__ 2>/dev/null || true && git pull --ff-only"

Write-Host "==> Prepare server dist for upload (sudo password if asked - urmodel-owned dist blocks scp)"
& ssh -t @SshBase $SshHost "sudo rm -rf $RemoteApp/frontend/dist && mkdir -p $RemoteApp/frontend/dist && sudo chown -R brian:brian $RemoteApp/frontend/dist"
if ($LASTEXITCODE -ne 0) {
    throw "Could not prepare frontend/dist on server (exit $LASTEXITCODE). SSH in and run: sudo rm -rf $RemoteApp/frontend/dist && sudo mkdir -p $RemoteApp/frontend/dist && sudo chown -R brian:brian $RemoteApp/frontend/dist"
}

Write-Host "==> Upload frontend/dist"
& scp @SshBase -r "$Root\frontend\dist" "${SshHost}:${RemoteApp}/frontend/"
if ($LASTEXITCODE -ne 0) {
    throw "scp upload failed (exit $LASTEXITCODE). Fix dist permissions on server then re-run publish.ps1"
}

Write-Host "==> Set dist permissions for Gunicorn (user urmodel)"
& ssh -t @SshBase $SshHost "sudo chown -R urmodel:urmodel $RemoteApp/frontend/dist && sudo chmod -R 755 $RemoteApp/frontend/dist"
if ($LASTEXITCODE -ne 0) {
    Write-Warning "Could not chown dist to urmodel - on server run: sudo chown -R urmodel:urmodel $RemoteApp/frontend/dist && sudo chmod -R 755 $RemoteApp/frontend/dist"
}

Write-Host "==> Server: deploy.sh (no sudo - enter SSH key passphrase if asked)"
& ssh @SshBase $SshHost "cd $RemoteApp && SKIP_FRONTEND_BUILD=1 bash deploy.sh"
if ($LASTEXITCODE -ne 0) {
    throw "deploy.sh failed (exit $LASTEXITCODE). SSH in and run: cd $RemoteApp && SKIP_FRONTEND_BUILD=1 bash deploy.sh"
}

Write-Host "==> Check staticfiles/js on server"
$jsLine = & ssh @SshBase $SshHost "ls -1 $RemoteApp/staticfiles/js/main.*.js 2>/dev/null | head -1"
if ($jsLine) {
    Write-Host "    OK: $jsLine"
} else {
    Write-Warning "No staticfiles/js/main.*.js - on server run: bash scripts/fix-static-on-server.sh"
}

Write-Host "==> Restart gunicorn (separate SSH - enter sudo password)"
& ssh -t @SshBase $SshHost "sudo systemctl restart gunicorn-ur-model"
$restartOk = ($LASTEXITCODE -eq 0)
if ($restartOk) {
    Write-Host "    Restarted OK"
} else {
    Write-Warning "Restart step failed or SSH dropped (exit $LASTEXITCODE)."
    Write-Warning "Open a normal SSH window to the server and run:"
    Write-Warning "  sudo systemctl restart gunicorn-ur-model"
}

if ($mainJsPath -and $restartOk) {
    $checkUrl = "$SiteUrl/$mainJsPath"
    Write-Host "==> Verify: $checkUrl"
    try {
        $resp = Invoke-WebRequest -Uri $checkUrl -Method Head -UseBasicParsing -TimeoutSec 30
        $ct = $resp.Headers['Content-Type']
        Write-Host "    HTTP $($resp.StatusCode) Content-Type: $ct"
        if ($ct -like '*html*') {
            Write-Warning "Still returning HTML. On server: bash scripts/fix-static-on-server.sh"
        }
    } catch {
        Write-Warning "Could not verify URL: $_"
    }
}

if ($restartOk) {
    Write-Host "==> Publish complete - hard refresh $SiteUrl (Ctrl+Shift+R)"
} else {
    Write-Host "==> Deploy files updated but RESTART REQUIRED - then hard refresh $SiteUrl"
}
