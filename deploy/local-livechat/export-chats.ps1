<#
  Exports real customer questions with the staff reply that followed each one, from your LOCAL LiveChat database (read only), into one file.
  The file goes into the bot panel: Check > Study real chats. The panel removes phone numbers, emails and account numbers when you load it,
  but it cannot find names: keep the file private and delete it when you are done.

  Run (PowerShell, in the bot folder):
    powershell -ExecutionPolicy Bypass -File deploy\local-livechat\export-chats.ps1
  Options:  -Days 90 (only the last 90 days)   -Tenant 1 (the LiveChat tenant id)   -OutFile C:\temp\chats.tsv
            -MySqlDir C:\lc-local\mysql-8.4.13-winx64   -Port 3307   -Database livechat
  For a staging copy, use the same command with the staging host: -DbHost and -User (ask for a READ-ONLY user, never use an admin one).
#>
param(
  [string]$MySqlDir = 'C:\lc-local\mysql-8.4.13-winx64', [int]$Port = 3307, [string]$Database = 'livechat', [int]$Tenant = 1, [int]$Days = 0,
  [string]$OutFile = 'chats_for_study.tsv', [string]$DbHost = '127.0.0.1', [string]$User = 'root', [string]$Password = ''
)
$ErrorActionPreference = 'Stop'
$mysql = Join-Path $MySqlDir 'bin\mysql.exe'
if (-not (Test-Path $mysql)) { throw "mysql.exe not found at $mysql. Use -MySqlDir with the folder that holds bin\mysql.exe." }
$since = if ($Days -gt 0) { "AND m.created_at >= DATE_SUB(NOW(), INTERVAL $Days DAY)" } else { '' }
# A customer message and the FIRST staff reply after it, as long as the customer did not write again in between.
$sql = @"
SELECT m.body AS question,
  (SELECT r.body FROM messages r
    WHERE r.conversation_id = m.conversation_id AND r.id > m.id AND r.sender_type = 'operator' AND r.message_type = 'text'
      AND r.id < COALESCE((SELECT MIN(n.id) FROM messages n WHERE n.conversation_id = m.conversation_id AND n.id > m.id AND n.sender_type IN ('visitor','customer')), 9223372036854775807)
    ORDER BY r.id LIMIT 1) AS reply
FROM messages m
WHERE m.tenant_id = $Tenant AND m.sender_type IN ('visitor','customer') AND m.message_type = 'text' $since
HAVING reply IS NOT NULL;
"@
$tmp = Join-Path $env:TEMP 'export-chats.sql'
Set-Content -Path $tmp -Value $sql -Encoding ascii
$pw = if ($Password) { "--password=$Password" } else { '' }
$out = Join-Path (Get-Location) $OutFile; if ([IO.Path]::IsPathRooted($OutFile)) { $out = $OutFile }
# cmd.exe keeps the bytes as they are (PowerShell would change Chinese and Malay letters)
cmd /c "`"$mysql`" --user=$User $pw --host=$DbHost --port=$Port --batch --default-character-set=utf8mb4 $Database < `"$tmp`" > `"$out`""
Remove-Item $tmp -ErrorAction SilentlyContinue
if ($LASTEXITCODE -ne 0) { throw 'The export failed (see the message above).' }
$n = (Get-Content $out | Measure-Object -Line).Lines - 1
Write-Host "Done: $n question and reply pairs in $out" -ForegroundColor Green
Write-Host 'Next: open the panel, Check > Study real chats, choose this file. Keep the file private; delete it when you are done.'
