<#
  Adds ONE merchant to your LOCAL LiveChat and links it to the same merchant in the bot.
  Use it for a merchant you made in the bot panel (Add merchant): the bot panel and LiveChat each have their own list of merchants,
  and a merchant made in one does not appear in the other. This makes it in LiveChat, makes the admin (admin@a.test) a member of it,
  makes a bot key, sets the key in that merchant's AI Bot settings, and tests the link. Then LiveChat shows it in the merchant list.

  Before you run it: LiveChat is running (setup-nodocker.ps1) and the bot is running (npm run dev), and the merchant is in the bot panel.

  Run (in the bot folder, PowerShell). -Code is the merchant's code in the bot panel (shown small under its name):
    powershell -ExecutionPolicy Bypass -File deploy\local-livechat\add-merchant.ps1 -Code 77Y8
  Options: -Name "77Y8 SG" (the name LiveChat shows; default: the code)   -MySqlDir C:\lc-local\mysql-8.4.13-winx64   -BotUrl http://localhost:3000
  Safe to run again: it never adds the merchant twice (each run makes a new bot key; the older ones keep working).
  Then sign in to LiveChat again (or refresh the page) and open the merchant list at the top.
#>
param(
  [Parameter(Mandatory = $true)][string]$Code, [string]$Name = '', [string]$ToolsDir = 'C:\lc-local', [int]$MySqlPort = 3307, [string]$MySqlDir = '', [string]$BotUrl = 'http://localhost:3000'
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$botDir = Resolve-Path (Join-Path $PSScriptRoot '..\..')
function Run { param([scriptblock]$Do) $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'; try { & $Do } finally { $ErrorActionPreference = $old } }
$Code = $Code.Trim().ToUpper()
if ($Code -notmatch '^[A-Z0-9_]{2,30}$') { throw 'The code is 2 to 30 letters, digits or underscore, for example 77Y8 (see it on the merchant page in the bot panel).' }
if (-not $Name) { $Name = $Code }
if ($Name -notmatch "^[A-Za-z0-9 ._&-]{1,60}$") { throw 'The name may only have letters, digits, spaces and . _ & - (up to 60 characters).' }
$slug = ($Code.ToLower() -replace '[^a-z0-9]+', '-').Trim('-')
$chars = 'ABCDEFGHJKMNPQRSTVWXYZ0123456789'; $rand = -join (1..11 | ForEach-Object { $chars[(Get-Random -Maximum $chars.Length)] }); $publicId = '01JTESTMERCHANT' + $rand

if ($MySqlDir) { $mysql = Join-Path $MySqlDir 'bin\mysql.exe' }
else { $found = Get-ChildItem $ToolsDir -Recurse -Filter mysql.exe -Depth 5 -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match '\\bin\\mysql\.exe$' } | Select-Object -First 1; if ($found) { $mysql = $found.FullName } }
if (-not $mysql -or -not (Test-Path $mysql)) { throw 'mysql.exe not found. Use -MySqlDir with the folder that holds bin\mysql.exe, for example C:\lc-local\mysql-8.4.13-winx64' }
try { Invoke-RestMethod http://localhost:8080/login | Out-Null } catch { throw 'LiveChat is not running on http://localhost:8080. Start it first: setup-nodocker.ps1' }
try { Invoke-RestMethod "$BotUrl/health" | Out-Null } catch { throw "The bot is not running on $BotUrl. Run: npm run dev" }

Write-Host "1/3 Adding $Name ($slug) to LiveChat, and the admin as a member of it..."
$sql = @"
INSERT INTO merchants(public_id, name, slug, status, created_at, updated_at)
SELECT '$publicId', '$($Name.Replace("'", "''"))', '$slug', 'active', NOW(), NOW() WHERE NOT EXISTS (SELECT 1 FROM merchants WHERE slug = '$slug');
INSERT INTO user_tenant_memberships(user_id, tenant_id, role_id, status, is_default, created_at, updated_at)
SELECT u.id, m.id, r.id, 'active', 0, NOW(), NOW() FROM users u JOIN merchants m ON m.slug = '$slug' JOIN roles r ON r.name = 'merchant_admin'
WHERE u.email = 'admin@a.test' AND NOT EXISTS (SELECT 1 FROM user_tenant_memberships x WHERE x.user_id = u.id AND x.tenant_id = m.id);
"@
$tmp = Join-Path $env:TEMP 'add-merchant.sql'; Set-Content -Path $tmp -Value $sql -Encoding ascii
Run { Get-Content $tmp -Raw | & $mysql --user=root --host=127.0.0.1 "--port=$MySqlPort" livechat }
if ($LASTEXITCODE -ne 0) { throw 'Could not add the merchant to LiveChat. Is merchant A there (setup-nodocker.ps1)?' }
Remove-Item $tmp -ErrorAction SilentlyContinue
Run { $script:idText = & $mysql --user=root --host=127.0.0.1 "--port=$MySqlPort" --batch --skip-column-names -e "SELECT id FROM livechat.merchants WHERE slug = '$slug'" }
$id = ("$idText").Trim()
if ($id -notmatch '^\d+$') { throw "The merchant was not found in LiveChat after adding it ($slug)." }

Write-Host "2/3 Making a bot key for $Code..."
Push-Location $botDir
try { Run { $script:out = npm run --silent key:create -- $Code 2>&1 | Out-String } } finally { Pop-Location }
if ($out -notmatch '(aib_[A-Za-z0-9_-]+)') { throw "Could not make a bot key. Is $Code a merchant in the bot panel? $($out.Trim())" }
$key = $Matches[1]

Write-Host '3/3 Setting the key in LiveChat and testing the link...'
$login = @{ email = 'admin@a.test'; password = 'Test1234!' } | ConvertTo-Json
Invoke-RestMethod -Uri http://localhost:8080/login -Method Post -ContentType 'application/json' -Body $login -SessionVariable lc | Out-Null
$body = @{ ai_bot_enabled = $true; ai_chat_api_base_url = $BotUrl; ai_chat_api_key = $key; ai_handoff_prompt_after_replies = 3; ai_bot_display_name = 'Bot'; ai_bot_avatar_url = '' } | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:8080/merchant/automation?tenant_id=$id" -Method Patch -ContentType 'application/json' -Body $body -WebSession $lc | Out-Null
$test = @{ ai_chat_api_base_url = $BotUrl; ai_chat_api_key = $key; question = 'Can you help?' } | ConvertTo-Json
$r = Invoke-RestMethod -Uri "http://localhost:8080/merchant/automation/ai-chat/test?tenant_id=$id" -Method Post -ContentType 'application/json' -Body $test -WebSession $lc
Write-Host ''
Write-Host "Done: $Name is LiveChat merchant $id, linked to $Code in the bot. The bot answered the test:" -ForegroundColor Green
Write-Host $r.answer
Write-Host ''
Write-Host "Refresh LiveChat (http://localhost:8080) and pick $Name in the merchant list at the top. Its chats use the widget with the header X-Tenant-ID: $id."
