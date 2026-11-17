<#
  Makes LiveChat send the signed-in member to the AI bot (so the bot can answer "check my balance").
  It applies deploy\local-livechat\patches\member-to-bot.patch to your LiveChat folder, then you rebuild and restart LiveChat.

  Run (in the bot folder, PowerShell):
    powershell -ExecutionPolicy Bypass -File deploy\local-livechat\apply-member-patch.ps1 -LiveChatDir C:\livechat-develop
  Then rebuild and restart LiveChat (this builds it again and starts the API and the worker):
    powershell -ExecutionPolicy Bypass -File deploy\local-livechat\setup-nodocker.ps1 -LiveChatDir C:\livechat-develop
  It needs Git for Windows (the "git" command). Safe to run twice: it says so when the patch is already there.
#>
param([Parameter(Mandatory = $true)][string]$LiveChatDir)
$ErrorActionPreference = 'Stop'
$patch = Join-Path $PSScriptRoot 'patches\member-to-bot.patch'
if (-not (Test-Path $patch)) { throw "Cannot find $patch" }
if (-not (Test-Path (Join-Path $LiveChatDir 'internal\automation\ai_reply.go'))) { throw "$LiveChatDir is not the LiveChat folder (internal\automation\ai_reply.go is missing)." }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'The git command was not found. Install Git for Windows (https://git-scm.com/download/win), open a new PowerShell and run this again.' }
Push-Location $LiveChatDir
try {
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  & git apply --ignore-whitespace --check -R $patch 2>$null
  if ($LASTEXITCODE -eq 0) { Write-Host 'The patch is already applied. Nothing to do.' -ForegroundColor Green; return }
  & git apply --ignore-whitespace --check $patch
  if ($LASTEXITCODE -ne 0) { $ErrorActionPreference = $old; throw 'The patch does not fit this LiveChat folder (it may be another version). Copy the lines above and send them.' }
  & git apply --ignore-whitespace $patch
  if ($LASTEXITCODE -ne 0) { $ErrorActionPreference = $old; throw 'Applying the patch failed.' }
  $ErrorActionPreference = $old
  Write-Host 'Done. Now rebuild and restart LiveChat with setup-nodocker.ps1 (see the top of this file).' -ForegroundColor Green
} finally { Pop-Location }
