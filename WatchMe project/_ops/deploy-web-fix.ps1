$ErrorActionPreference = "Stop"

$hostName = "root@139.59.184.74"
$projectRoot = "C:\Users\yid19\OneDrive\Desktop\WatchMe project"
$frontendRoot = Join-Path $projectRoot "webpage watchme\WatchMe-Pro-Front-End"
$serverFile = Join-Path $projectRoot "webpage watchme\server.js"
$appFile = Join-Path $frontendRoot "src\App.jsx"
$brandingDir = Join-Path $frontendRoot "public\branding"

Write-Host "Uploading live web fix..." -ForegroundColor Cyan
scp $serverFile "${hostName}:/srv/watchme/web-src/server.js"
scp $appFile "${hostName}:/srv/watchme/web-src/WatchMe-Pro-Front-End/src/App.jsx"
scp -r $brandingDir "${hostName}:/srv/watchme/web-src/WatchMe-Pro-Front-End/public/"

Write-Host "Building and restarting live web app..." -ForegroundColor Cyan
ssh $hostName "cd /srv/watchme/web-src/WatchMe-Pro-Front-End && npm run build && cp -r dist/* /srv/watchme/web-src/dist/ && pm2 restart watchme-web --update-env"

Write-Host "Done. Hard refresh https://www.watchme-bot.com/ and test Discord login." -ForegroundColor Green
