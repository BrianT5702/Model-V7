# One-command deploy: build on PC -> sync server -> upload dist -> deploy
# Usage (from repo root):
#   .\publish.ps1
#   .\publish.ps1 -Push

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

$mainJsMatch = Select-String -Path "$Root\frontend\dist\asset-manifest.json" -Pattern 'static/js/main\.[A-Za-z0-9_-]+\.js' | Select-Object -First 1
$mainJsPath = if ($mainJsMatch) { $mainJsMatch.Matches.Value } else { $null }
if ($mainJsPath) { Write-Host "    Built: $mainJsPath" }

Write-Host "==> Server: sync code from GitHub (sudo password may be asked)"
$syncCmd = 'sudo rm -rf {0}/frontend/dist {0}/staticfiles; cd {0} && git fetch origin && git reset --hard origin/main && mkdir -p frontend/dist && chown -R brian:brian frontend/dist' -f $RemoteApp
& ssh -t @SshBase $SshHost $syncCmd
if ($LASTEXITCODE -ne 0) {
    Write-Warning "Server sync failed (exit $LASTEXITCODE). In SSH run:"
    Write-Warning "  cd ~/ur-model/app; sudo rm -rf frontend/dist staticfiles; git fetch origin; git reset --hard origin/main"
    throw "Server sync failed - fix SSH manually then re-run publish.ps1"
}

Write-Host "==> Upload frontend/dist"
& scp @SshBase -r "$Root\frontend\dist" "${SshHost}:${RemoteApp}/frontend/"
if ($LASTEXITCODE -ne 0) {
    throw "scp upload failed (exit $LASTEXITCODE)"
}

Write-Host "==> Set dist permissions for Gunicorn (user urmodel)"
$chownCmd = 'sudo chown -R urmodel:urmodel {0}/frontend/dist; sudo chmod -R 755 {0}/frontend/dist' -f $RemoteApp
& ssh -t @SshBase $SshHost $chownCmd
if ($LASTEXITCODE -ne 0) {
    Write-Warning "Could not chown dist - on server run: sudo chown -R urmodel:urmodel ~/ur-model/app/frontend/dist"
}

Write-Host "==> Server: deploy.sh (sudo password may be asked)"
$deployCmd = 'cd {0} && SKIP_FRONTEND_BUILD=1 bash deploy.sh' -f $RemoteApp
& ssh -t @SshBase $SshHost $deployCmd
$deployOk = ($LASTEXITCODE -eq 0)
if (-not $deployOk) {
    Write-Warning "deploy.sh failed (exit $LASTEXITCODE) - trying finish (staticfiles perms + restart)..."
    $finishCmd = 'sudo chown -R urmodel:urmodel {0}/staticfiles {0}/frontend/dist; sudo chmod -R 755 {0}/staticfiles {0}/frontend/dist; sudo systemctl restart gunicorn-ur-model' -f $RemoteApp
    & ssh -t @SshBase $SshHost $finishCmd
    if ($LASTEXITCODE -ne 0) {
        throw "deploy.sh failed and finish step failed (exit $LASTEXITCODE)"
    }
    Write-Host "    Finish step OK (staticfiles + gunicorn)"
}

Write-Host "==> Check staticfiles/js on server"
$jsLine = & ssh @SshBase $SshHost "ls -1 $RemoteApp/staticfiles/js/main.*.js 2>/dev/null | head -1"
if ($jsLine) {
    Write-Host "    OK: $jsLine"
} else {
    Write-Warning "No staticfiles/js/main.*.js found"
}

$restartOk = $false
if ($deployOk) {
    Write-Host "==> Restart gunicorn (enter sudo password)"
    & ssh -t @SshBase $SshHost "sudo systemctl restart gunicorn-ur-model"
    $restartOk = ($LASTEXITCODE -eq 0)
} else {
    $restartOk = $true
}
if ($restartOk) {
    Write-Host "    Restarted OK"
} else {
    Write-Warning "Restart failed - SSH in and run: sudo systemctl restart gunicorn-ur-model"
}

if ($mainJsPath -and $restartOk) {
    $checkUrl = "$SiteUrl/$mainJsPath"
    Write-Host "==> Verify: $checkUrl"
    try {
        $resp = Invoke-WebRequest -Uri $checkUrl -Method Head -UseBasicParsing -TimeoutSec 30
        $ct = $resp.Headers['Content-Type']
        Write-Host "    HTTP $($resp.StatusCode) Content-Type: $ct"
        if ($ct -like '*html*') {
            Write-Warning "Still returning HTML for JS URL"
        }
    } catch {
        Write-Warning "Could not verify URL: $_"
    }
}

if ($restartOk) {
    Write-Host "==> Publish complete - hard refresh $SiteUrl (Ctrl+Shift+R)"
} else {
    Write-Host "==> Deploy done but RESTART REQUIRED - then hard refresh $SiteUrl"
}
