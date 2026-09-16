<#
  pack-prod.ps1

  Builds MoviePalace and assembles a production-ready release package.

  Output:
    release\moviepalace-YYYYMMDD-HHmm\    - the release folder
    release\moviepalace-YYYYMMDD-HHmm.zip - compressed archive ready to upload

  Usage:
    npm run pack
    -- or directly:
    powershell -ExecutionPolicy Bypass -File pack-prod.ps1

  What the production server needs after extracting the zip:
    1. npm install --omit=dev
    2. cp .env.example .env   (then fill in TMDB_TOKEN and DATABASE_URL)
    3. node dist/moviepalace-server.js
#>

$ErrorActionPreference = 'Stop'

$serverRoot = $PSScriptRoot
Set-Location $serverRoot

# -- 1. Build ------------------------------------------------------------------
Write-Host ''
Write-Host 'Building...' -ForegroundColor Cyan
npm run buildWin
if ($LASTEXITCODE -ne 0) {
    Write-Error 'Build failed - aborting.'
    exit 1
}
Write-Host 'Build OK' -ForegroundColor Green

# -- 2. Create release directory -----------------------------------------------
$stamp       = Get-Date -Format 'yyyyMMdd-HHmm'
$releaseName = "moviepalace-$stamp"
$releaseRoot = Join-Path $serverRoot 'release'
$releaseDir  = Join-Path $releaseRoot $releaseName

New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
Write-Host ''
Write-Host "Assembling release: $releaseDir" -ForegroundColor Cyan

# -- 3. Copy production files --------------------------------------------------
# Compiled JS + static assets (blurred-poster HTML is copied in by copy-static)
Copy-Item -Path "$serverRoot\dist"              -Destination "$releaseDir\dist"             -Recurse -Force
# Prisma schema + migrations (needed if you run migrations on the server)
Copy-Item -Path "$serverRoot\prisma"            -Destination "$releaseDir\prisma"           -Recurse -Force
# npm metadata so the server can install production dependencies
Copy-Item -Path "$serverRoot\package.json"      -Destination "$releaseDir\package.json"
Copy-Item -Path "$serverRoot\package-lock.json" -Destination "$releaseDir\package-lock.json"
# Environment template
Copy-Item -Path "$serverRoot\.env.example"      -Destination "$releaseDir\.env.example"
# Prisma config (tells Prisma where to find the DB URL and schema)
Copy-Item -Path "$serverRoot\prisma.config.ts"  -Destination "$releaseDir\prisma.config.ts"

# -- 4. Copy database ----------------------------------------------------------
$dbSource = Join-Path $serverRoot 'dev.db'
if (Test-Path $dbSource) {
    Copy-Item -Path $dbSource -Destination "$releaseDir\moviepalace.db" -Force
    Write-Host 'Database included as moviepalace.db' -ForegroundColor Green
} else {
    Write-Warning 'dev.db not found - the server will need a database before it can start.'
    Write-Warning 'Run npm run db:sync-all on a dev machine first, then re-run pack.'
}

# -- 5. Compress ---------------------------------------------------------------
# Use .NET ZipFile directly so paths inside the archive always use forward
# slashes (Compress-Archive can embed Windows backslashes which confuse unzip
# on Linux, causing subdirectories to appear as literal filenames).
$zipPath = "$releaseDir.zip"
if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
}
Add-Type -Assembly 'System.IO.Compression.FileSystem'
[System.IO.Compression.ZipFile]::CreateFromDirectory($releaseDir, $zipPath)
Write-Host "Archive: $zipPath" -ForegroundColor Green

# -- 6. Deployment instructions ------------------------------------------------
Write-Host ''
Write-Host '=== Deploy to production ===' -ForegroundColor Yellow
Write-Host ''
Write-Host "  1. Upload $releaseName.zip to the server"
Write-Host "  2. unzip $releaseName.zip && cd $releaseName"
Write-Host '  3. npm install --omit=dev'
Write-Host '  4. cp .env.example .env'
Write-Host '     nano .env   # set TMDB_TOKEN and DATABASE_URL'
Write-Host '  5. node dist/moviepalace-server.js'
Write-Host ''
Write-Host '  To run persistently with PM2:'
Write-Host '    pm2 start dist/moviepalace-server.js --name moviepalace'
Write-Host ''
