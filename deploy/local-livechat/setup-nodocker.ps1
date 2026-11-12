<#
  Runs a LOCAL copy of LiveChat on Windows WITHOUT Docker and links the AI bot to it.
  Nothing here touches staging or any GitHub. LiveChat needs only Go and MySQL 8 (Redis is NOT needed: it is used for one health check).
  Everything it downloads goes into one folder (default C:\lc-local), so you can delete that folder to remove it all.
  It uses its own MySQL on port 3307, so XAMPP is not touched.

  Before you run it:
    1. The bot is running:  npm run dev   (http://localhost:3000)
    2. Unzip the LiveChat project, for example to C:\livechat-develop
    3. Internet is on (downloads Go ~80 MB, MySQL ~250 MB, then LiveChat's Go packages)

  Run (in the bot folder, PowerShell):
    powershell -ExecutionPolicy Bypass -File deploy\local-livechat\setup-nodocker.ps1 -LiveChatDir C:\livechat-develop
  Stop everything again:
    powershell -ExecutionPolicy Bypass -File deploy\local-livechat\setup-nodocker.ps1 -LiveChatDir C:\livechat-develop -Stop
  Run it again later to start LiveChat again: it skips what is already done.
#>
param(
  [Parameter(Mandatory = $true)][string]$LiveChatDir,
  [string]$ToolsDir = 'C:\lc-local',
  [int]$MySqlPort = 3307,
  [string]$Merchant = 'MERCH_A',
  [string]$BotUrl = 'http://localhost:3000',
  [string]$MySqlZip = '',
  [string]$MySqlDir = '',   # an already unzipped MySQL 8 folder (the one that holds bin\mysqld.exe)
  [string]$GoZip = '',
  [switch]$Stop
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # makes downloads much faster
$GoVersion = '1.24.7'
$MySqlVersion = '8.4.6'
$botDir = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$bin = Join-Path $ToolsDir 'bin'; $logs = Join-Path $ToolsDir 'logs'
New-Item -ItemType Directory -Force $ToolsDir, $bin, $logs | Out-Null


# Programs such as mysqld, go and npm print progress on stderr. PowerShell would treat that as a fatal error, so run them through this.
function Run { param([scriptblock]$Do) $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'; try { & $Do } finally { $ErrorActionPreference = $old } }
function Ping-MySql { $script:pingOut = (Run { & $mysqladmin -uroot -h127.0.0.1 -P $MySqlPort --protocol=tcp ping 2>&1 | Out-String }); return ($LASTEXITCODE -eq 0) }
function Port-Open { return [bool](Get-NetTCPConnection -LocalPort $MySqlPort -State Listen -ErrorAction SilentlyContinue) }

function Stop-Mine {
  foreach ($n in 'lc-api', 'lc-worker') { Get-Process $n -ErrorAction SilentlyContinue | Stop-Process -Force }
  $roots = @($ToolsDir); if ($MySqlDir) { $roots += $MySqlDir }
  $mysqlAdmin = $roots | ForEach-Object { Get-ChildItem $_ -Recurse -Filter mysqladmin.exe -ErrorAction SilentlyContinue } | Select-Object -First 1
  if ($mysqlAdmin) { Run { & $mysqlAdmin.FullName -uroot -h127.0.0.1 -P $MySqlPort shutdown *> $null } }
}
if ($Stop) { Stop-Mine; Write-Host 'LiveChat and its MySQL are stopped.'; return }

function Get-Zip($urls, $dest, $marker, $localZip) {
  if (Test-Path (Join-Path $dest $marker)) { return }
  $zip = Join-Path $ToolsDir 'download.zip'
  if ($localZip) { Copy-Item $localZip $zip -Force }
  else {
    $ok = $false
    foreach ($url in $urls) {
      Write-Host "   downloading $url"
      try {
        Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing -UserAgent 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        $head = [IO.File]::ReadAllBytes($zip)[0..1]   # a real zip starts with "PK"; an error page does not
        if ((Get-Item $zip).Length -gt 20MB -and $head[0] -eq 0x50 -and $head[1] -eq 0x4B) { $ok = $true; break }
        Write-Host '   that address did not give a zip file, trying the next one'
      } catch { Write-Host "   failed: $($_.Exception.Message.Split([char]10)[0])" }
    }
    if (-not $ok) { throw "Could not download it. Download the zip yourself in a browser and run again with the file path, for example -MySqlZip D:\\Downloads\\mysql-8.4.6-winx64.zip (Go: -GoZip ...). MySQL: https://dev.mysql.com/downloads/mysql/ (choose 8.4 LTS, Windows x86 64-bit ZIP Archive, then 'No thanks, just start my download')." }
  }
  Expand-Archive -Path $zip -DestinationPath $dest -Force
  Remove-Item $zip
}

if (-not (Test-Path (Join-Path $LiveChatDir 'go.mod'))) {   # an unzipped folder often holds the project one level deeper
  $found = Get-ChildItem $LiveChatDir -Recurse -Filter go.mod -Depth 3 -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found) { $LiveChatDir = $found.DirectoryName; Write-Host "   LiveChat project found in $LiveChatDir" }
  else { throw "No go.mod found in or under $LiveChatDir. Is this the LiveChat folder? It should contain go.mod, cmd and internal. Check that the zip was fully unzipped." }
}
Write-Host '1/7 Checking the bot...'
try { Invoke-RestMethod http://localhost:3000/health | Out-Null } catch { throw 'The bot is not running on http://localhost:3000. Run: npm run dev' }

Write-Host '2/7 Go...'
$goExe = (Get-Command go -ErrorAction SilentlyContinue).Source
if (-not $goExe) {
  Get-Zip @("https://go.dev/dl/go$GoVersion.windows-amd64.zip") $ToolsDir 'go\bin\go.exe' $GoZip
  $goExe = Join-Path $ToolsDir 'go\bin\go.exe'
}
Write-Host "   using $goExe"

Write-Host '3/7 MySQL 8 (own copy, port ' $MySqlPort ')...'
if ($MySqlDir) {
  if (-not (Test-Path (Join-Path $MySqlDir 'bin\mysqld.exe'))) { throw "No bin\mysqld.exe in $MySqlDir. Point -MySqlDir at the folder that contains the bin folder." }
  $mysqlRoot = (Resolve-Path $MySqlDir).Path
} else {
  $mysqlRoot = Join-Path $ToolsDir "mysql-$MySqlVersion-winx64"
  Get-Zip @("https://dev.mysql.com/get/Downloads/MySQL-8.4/mysql-$MySqlVersion-winx64.zip", "https://downloads.mysql.com/archives/get/p/23/file/mysql-$MySqlVersion-winx64.zip") $ToolsDir "mysql-$MySqlVersion-winx64\bin\mysqld.exe" $MySqlZip
}
$mysqld = Join-Path $mysqlRoot 'bin\mysqld.exe'; $mysql = Join-Path $mysqlRoot 'bin\mysql.exe'; $mysqladmin = Join-Path $mysqlRoot 'bin\mysqladmin.exe'
$data = Join-Path $ToolsDir 'mysql-data'
$ini = Join-Path $ToolsDir 'my.ini'
@"
[mysqld]
basedir=$($mysqlRoot -replace '\\','/')
datadir=$($data -replace '\\','/')
port=$MySqlPort
bind-address=127.0.0.1
character-set-server=utf8mb4
collation-server=utf8mb4_unicode_ci
mysqlx=0
"@ | Set-Content -Encoding ascii $ini
if (-not (Test-Path (Join-Path $data 'mysql'))) {
  Write-Host '   first start: creating the data folder (1-5 minutes on a slow machine, please wait)'
  Run { & $mysqld "--defaults-file=$ini" --initialize-insecure --console }
  if ($LASTEXITCODE -ne 0) { throw 'MySQL could not initialise. If Windows says VCRUNTIME140.dll is missing, install the "Microsoft Visual C++ Redistributable 2015-2022 (x64)" and run again.' }
}
$up = Ping-MySql
if (-not $up) {
  if (Port-Open) { Write-Host "   Something already listens on port $MySqlPort (probably MySQL from an earlier run); waiting for it instead of starting another one." }
  elseif (Get-Process mysqld -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $mysqld }) { Write-Host '   A MySQL from an earlier run is still starting; waiting for it.' }
  else { Start-Process -FilePath $mysqld -ArgumentList "--defaults-file=$ini", '--console' -WindowStyle Hidden -RedirectStandardError (Join-Path $logs 'mysql.log') }
  1..150 | ForEach-Object { if (-not $up) { Start-Sleep 2; $up = Ping-MySql } }
  if (-not $up) {
    Write-Host '--- MySQL did not start. Its own messages (last 40 lines) ---' -ForegroundColor Yellow
    $lf = Join-Path $logs 'mysql.log'
    if (Test-Path $lf) { Get-Content $lf -Tail 40 } else { Write-Host '(no log file)' }
    Write-Host ('--- mysqld running now: ' + [bool](Get-Process mysqld -ErrorAction SilentlyContinue) + ' | port ' + $MySqlPort + ' in use by: ' + ((Get-NetTCPConnection -LocalPort $MySqlPort -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess))) -ForegroundColor Yellow
    Write-Host ('--- last answer of mysqladmin ping: ' + $script:pingOut) -ForegroundColor Yellow
    throw "MySQL did not start. Copy the lines above and send them."
  }
}
Run { & $mysql -uroot -h127.0.0.1 -P $MySqlPort -e "CREATE DATABASE IF NOT EXISTS livechat CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE USER IF NOT EXISTS 'livechat'@'%' IDENTIFIED BY 'livechat'; GRANT ALL ON livechat.* TO 'livechat'@'%';" }
if ($LASTEXITCODE -ne 0) { throw 'Could not create the LiveChat database.' }

Write-Host '4/7 Building LiveChat (first time takes a few minutes)...'
$apiExe = Join-Path $bin 'lc-api.exe'; $workerExe = Join-Path $bin 'lc-worker.exe'
Stop-Process -Name lc-api, lc-worker -Force -ErrorAction SilentlyContinue
Push-Location $LiveChatDir
try {
  Run { & $goExe build -o $apiExe ./cmd/api };       if ($LASTEXITCODE -ne 0) { throw 'Building the LiveChat API failed (see the messages above).' }
  Run { & $goExe build -o $workerExe ./cmd/worker }; if ($LASTEXITCODE -ne 0) { throw 'Building the LiveChat worker failed (see the messages above).' }
} finally { Pop-Location }

Write-Host '5/7 Starting LiveChat...'
$bytes = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$keyFile = Join-Path $ToolsDir 'app.key'
if (-not (Test-Path $keyFile)) { "base64:$([Convert]::ToBase64String($bytes))" | Set-Content -Encoding ascii -NoNewline $keyFile }
$env:APP_ENV = 'local'; $env:APP_KEY = (Get-Content $keyFile -Raw)
$env:LIVECHAT_HTTP_ADDR = ':8080'; $env:LIVECHAT_PUBLIC_BUILD_DIR = 'public/build'; $env:LIVECHAT_UPLOAD_DIR = (Join-Path $ToolsDir 'uploads')
$env:DB_HOST = '127.0.0.1'; $env:DB_PORT = "$MySqlPort"; $env:DB_DATABASE = 'livechat'; $env:DB_USERNAME = 'livechat'; $env:DB_PASSWORD = 'livechat'
$env:REDIS_HOST = '127.0.0.1'; $env:REDIS_PORT = '6379'; $env:LIVECHAT_REALTIME_ENABLED = 'false'
New-Item -ItemType Directory -Force $env:LIVECHAT_UPLOAD_DIR | Out-Null
Start-Process -FilePath $apiExe -WorkingDirectory $LiveChatDir -WindowStyle Hidden -RedirectStandardError (Join-Path $logs 'api.log') -RedirectStandardOutput (Join-Path $logs 'api.out.log')
$ready = $false   # /login answers 200 once the API and its tables are up (/health says "degraded" without Redis, which is fine)
1..150 | ForEach-Object { if (-not $ready) { try { Invoke-RestMethod http://localhost:8080/login | Out-Null; $ready = $true } catch { Start-Sleep 2 } } }
if (-not $ready) { throw "LiveChat did not start. See $logs\api.log and api.out.log" }
Start-Process -FilePath $workerExe -WorkingDirectory $LiveChatDir -WindowStyle Hidden -RedirectStandardError (Join-Path $logs 'worker.log') -RedirectStandardOutput (Join-Path $logs 'worker.out.log')

Write-Host '6/7 Adding merchant A and its admin...'
Run { Get-Content (Join-Path $PSScriptRoot 'seed.sql') -Raw | & $mysql -uroot -h127.0.0.1 -P $MySqlPort livechat }
if ($LASTEXITCODE -ne 0) { throw 'Could not add the merchant.' }

Write-Host "7/7 Issuing the bot key for $Merchant and setting it in LiveChat..."
Push-Location $botDir
try { Run { $script:out = npm run --silent key:create -- $Merchant 2>&1 | Out-String } } finally { Pop-Location }
if ($out -notmatch '(aib_[A-Za-z0-9_-]+)') { throw "Could not read the bot key. Output was: $out" }
$key = $Matches[1]
$login = @{ email = 'admin@a.test'; password = 'Test1234!' } | ConvertTo-Json
Invoke-RestMethod -Uri http://localhost:8080/login -Method Post -ContentType 'application/json' -Body $login -SessionVariable lc | Out-Null
$body = @{ ai_bot_enabled = $true; ai_chat_api_base_url = $BotUrl; ai_chat_api_key = $key; ai_handoff_prompt_after_replies = 3; ai_bot_display_name = 'Bot'; ai_bot_avatar_url = '' } | ConvertTo-Json
Invoke-RestMethod -Uri http://localhost:8080/merchant/automation -Method Patch -ContentType 'application/json' -Body $body -WebSession $lc | Out-Null
$test = @{ ai_chat_api_base_url = $BotUrl; ai_chat_api_key = $key; question = 'Can you help?' } | ConvertTo-Json
$r = Invoke-RestMethod -Uri http://localhost:8080/merchant/automation/ai-chat/test -Method Post -ContentType 'application/json' -Body $test -WebSession $lc

Write-Host ''
Write-Host 'Link works. The bot answered:' -ForegroundColor Green
Write-Host $r.answer
Write-Host ''
Write-Host 'LiveChat API: http://localhost:8080   admin@a.test / Test1234!   (the LiveChat screens are not built here; use chat.ps1)'
Write-Host 'Try a chat:   powershell -File deploy\local-livechat\chat.ps1 "how to deposit"'
Write-Host 'Stop:         add -Stop to this same command'
