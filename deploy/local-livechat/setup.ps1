<#
  Links the AI bot to a LOCAL copy of LiveChat (Docker Desktop). Nothing here touches staging or any GitHub.

  Before you run it:
    1. Docker Desktop is running.
    2. The bot is running:  npm run dev   (http://localhost:3000)
    3. Unzip the LiveChat project somewhere, for example C:\livechat-develop

  Run (in the bot folder, PowerShell):
    powershell -ExecutionPolicy Bypass -File deploy\local-livechat\setup.ps1 -LiveChatDir C:\livechat-develop
#>
param(
  [Parameter(Mandatory = $true)][string]$LiveChatDir,
  [string]$Merchant = 'MERCH_A',
  [string]$BotUrl = 'http://host.docker.internal:3000'   # how LiveChat (inside Docker) reaches the bot on your PC
)
$ErrorActionPreference = 'Stop'
$botDir = Resolve-Path (Join-Path $PSScriptRoot '..\..')
if (-not (Test-Path (Join-Path $LiveChatDir 'docker-compose.yml'))) { throw "No docker-compose.yml in $LiveChatDir" }

Write-Host '1/6 Checking Docker and the bot...'
docker info *> $null; if ($LASTEXITCODE -ne 0) { throw 'Docker is not running. Start Docker Desktop first.' }
try { Invoke-RestMethod http://localhost:3000/health | Out-Null } catch { throw 'The bot is not running on http://localhost:3000. Run: npm run dev' }

Write-Host '2/6 Writing LiveChat .env (local test values)...'
$envFile = Join-Path $LiveChatDir '.env'
if (-not (Test-Path $envFile)) {
  $bytes = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  "APP_ENV=local`nAPP_KEY=base64:$([Convert]::ToBase64String($bytes))`nLIVECHAT_REALTIME_ENABLED=false" | Set-Content -Encoding ascii $envFile
}

Write-Host '3/6 Starting LiveChat (the first build takes several minutes)...'
Push-Location $LiveChatDir
try {
  docker compose up -d --build
  if ($LASTEXITCODE -ne 0) { throw 'docker compose failed. If port 3306 or 8080 is busy, stop the program using it (for example XAMPP MySQL on 3306) and run again.' }

  Write-Host '4/6 Waiting for LiveChat...'
  $ok = $false
  1..90 | ForEach-Object { if (-not $ok) { try { Invoke-RestMethod http://localhost:8080/health | Out-Null; $ok = $true } catch { Start-Sleep 3 } } }
  if (-not $ok) { throw 'LiveChat did not start. Look at: docker compose logs go-api' }

  Write-Host '5/6 Adding merchant A and its admin to LiveChat...'
  Get-Content (Join-Path $PSScriptRoot 'seed.sql') -Raw | docker compose exec -T mysql mysql -uroot -proot livechat
  if ($LASTEXITCODE -ne 0) { throw 'Could not add the merchant. Look at: docker compose logs mysql' }
} finally { Pop-Location }

Write-Host "6/6 Issuing the bot key for $Merchant and setting it in LiveChat..."
Push-Location $botDir
try { $out = npm run --silent key:create -- $Merchant 2>&1 | Out-String } finally { Pop-Location }
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
Write-Host 'LiveChat:  http://localhost:8080   login admin@a.test / Test1234!'
Write-Host 'Bot panel: http://localhost:3000'
Write-Host 'Try a chat:  powershell -File deploy\local-livechat\chat.ps1 "how to deposit"'
