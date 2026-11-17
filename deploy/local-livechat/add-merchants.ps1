<#
  Adds more merchants to your LOCAL LiveChat (SwiftWallet, MegaPlay, BetKing, CashPoint, GameHub, named like the bot's demo merchants),
  makes the local admin (admin@a.test) a member of all of them, and links each one to its own merchant in the bot (a bot key for each).
  Then LiveChat shows the merchant switcher (the list of merchants on the left and the box at the top), like the real LiveChat.
  Nothing here touches staging. Merchant A is not changed.

  Before you run it:
    1. LiveChat is running (setup-nodocker.ps1 was run, merchant A works)
    2. The bot is running:  npm run dev   (http://localhost:3000)

  Run (in the bot folder, PowerShell):
    powershell -ExecutionPolicy Bypass -File deploy\local-livechat\add-merchants.ps1
  Options: -Merchants MERCH_B,MERCH_C   (only these)    -MySqlDir C:\lc-local\mysql-8.4.13-winx64    -BotUrl http://localhost:3000
  Safe to run again: it never adds the same merchant twice. It makes a NEW bot key each time and sets it in LiveChat (the older keys keep working).
  Then sign in to LiveChat again (http://localhost:8080, admin@a.test / Test1234!) and look at the top left: the merchants are there.
#>
param(
  [string]$ToolsDir = 'C:\lc-local', [int]$MySqlPort = 3307, [string]$MySqlDir = '', [string]$BotUrl = 'http://localhost:3000',
  [string[]]$Merchants = @('MERCH_B', 'MERCH_C', 'MERCH_D', 'MERCH_E', 'MERCH_F')
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$botDir = Resolve-Path (Join-Path $PSScriptRoot '..\..')
# Programs such as mysql and npm print progress on stderr. PowerShell would treat that as a fatal error, so run them through this.
function Run { param([scriptblock]$Do) $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'; try { & $Do } finally { $ErrorActionPreference = $old } }

if ($MySqlDir) { $mysql = Join-Path $MySqlDir 'bin\mysql.exe' }
else { $found = Get-ChildItem $ToolsDir -Recurse -Filter mysql.exe -Depth 5 -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match '\\bin\\mysql\.exe$' } | Select-Object -First 1; if ($found) { $mysql = $found.FullName } }
if (-not $mysql -or -not (Test-Path $mysql)) { throw 'mysql.exe not found. Use -MySqlDir with the folder that holds bin\mysql.exe, for example C:\lc-local\mysql-8.4.13-winx64' }
try { Invoke-RestMethod http://localhost:8080/login | Out-Null } catch { throw 'LiveChat is not running on http://localhost:8080. Start it first: setup-nodocker.ps1' }
try { Invoke-RestMethod "$BotUrl/health" | Out-Null } catch { throw "The bot is not running on $BotUrl. Run: npm run dev" }

Write-Host '1/3 Adding the merchants to LiveChat, and the admin as a member of each...'
Run { Get-Content (Join-Path $PSScriptRoot 'seed-merchants.sql') -Raw | & $mysql --user=root --host=127.0.0.1 "--port=$MySqlPort" livechat }
if ($LASTEXITCODE -ne 0) { throw 'Could not add the merchants. Is merchant A there (setup-nodocker.ps1)?' }

Write-Host '2/3 Signing in to LiveChat...'
$login = @{ email = 'admin@a.test'; password = 'Test1234!' } | ConvertTo-Json
Invoke-RestMethod -Uri http://localhost:8080/login -Method Post -ContentType 'application/json' -Body $login -SessionVariable lc | Out-Null

Write-Host '3/3 Linking each merchant to its own bot merchant...'
$ok = @()
foreach ($code in $Merchants) {
  $slug = 'merch-' + $code.Substring($code.Length - 1).ToLower()
  Run { $script:idText = & $mysql --user=root --host=127.0.0.1 "--port=$MySqlPort" --batch --skip-column-names -e "SELECT id FROM livechat.merchants WHERE slug = '$slug'" }
  $id = ("$idText").Trim()
  if ($id -notmatch '^\d+$') { Write-Warning "$code : there is no LiveChat merchant '$slug'. Skipped."; continue }
  Push-Location $botDir
  try { Run { $script:out = npm run --silent key:create -- $code 2>&1 | Out-String } } finally { Pop-Location }
  if ($out -notmatch '(aib_[A-Za-z0-9_-]+)') { Write-Warning "$code : could not make a bot key (is it a merchant in the bot panel?). $($out.Trim())"; continue }
  $key = $Matches[1]
  try {
    # LiveChat takes the merchant from ?tenant_id= in the address
    $body = @{ ai_bot_enabled = $true; ai_chat_api_base_url = $BotUrl; ai_chat_api_key = $key; ai_handoff_prompt_after_replies = 3; ai_bot_display_name = 'Bot'; ai_bot_avatar_url = '' } | ConvertTo-Json
    Invoke-RestMethod -Uri "http://localhost:8080/merchant/automation?tenant_id=$id" -Method Patch -ContentType 'application/json' -Body $body -WebSession $lc | Out-Null
    $test = @{ ai_chat_api_base_url = $BotUrl; ai_chat_api_key = $key; question = 'Can you help?' } | ConvertTo-Json
    Invoke-RestMethod -Uri "http://localhost:8080/merchant/automation/ai-chat/test?tenant_id=$id" -Method Post -ContentType 'application/json' -Body $test -WebSession $lc | Out-Null
    Write-Host "   $code (LiveChat merchant $id): linked, the bot answered the test" -ForegroundColor Green; $ok += $code
  } catch { Write-Warning "$code : LiveChat did not accept it: $($_.Exception.Message)" }
}
Write-Host ''
Write-Host "Done: $($ok.Count) of $($Merchants.Count) linked." -ForegroundColor Green
Write-Host 'Now sign in to LiveChat again: http://localhost:8080  admin@a.test / Test1234!  and look at the top left for the list of merchants.'
Write-Host 'Try a chat as another merchant: open that merchant in LiveChat, or use the widget with the tenant id shown in LiveChat (merchant B is 2, C is 3, and so on).'
