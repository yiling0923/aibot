<#
  Makes LiveChat work with the AI bot in two ways, by applying the patches in deploy\local-livechat\patches to your LiveChat folder:
    001  sends the signed-in member to the bot, so it can answer "check my balance" (and keeps that chat out of LiveChat's answer cache)
    002  lets the bot answer a picture, video or file the customer sends (LiveChat did not ask the bot about those at all)
  Then you rebuild and restart LiveChat.

  Run (in the bot folder, PowerShell):
    powershell -ExecutionPolicy Bypass -File deploy\local-livechat\apply-member-patch.ps1 -LiveChatDir C:\xampp\htdocs\livechat
  Then rebuild and restart LiveChat (this builds it again and starts the API and the worker):
    powershell -ExecutionPolicy Bypass -File deploy\local-livechat\setup-nodocker.ps1 -LiveChatDir C:\xampp\htdocs\livechat -MySqlDir C:\lc-local\mysql-8.4.13-winx64
  It needs Git for Windows (the "git" command). Safe to run twice: a patch that is already there is skipped.
#>
param([Parameter(Mandatory = $true)][string]$LiveChatDir)
$ErrorActionPreference = 'Stop'
$patches = Get-ChildItem (Join-Path $PSScriptRoot 'patches') -Filter '*.patch' | Sort-Object Name
if (-not $patches) { throw "No patches found in $(Join-Path $PSScriptRoot 'patches')" }
if (-not (Test-Path (Join-Path $LiveChatDir 'internal\automation\ai_reply.go'))) { throw "$LiveChatDir is not the LiveChat folder (internal\automation\ai_reply.go is missing)." }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'The git command was not found. Install Git for Windows (https://git-scm.com/download/win), open a new PowerShell and run this again.' }
Push-Location $LiveChatDir
try {
  foreach ($p in $patches) {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    & git apply --ignore-whitespace --check -R $p.FullName 2>$null
    if ($LASTEXITCODE -eq 0) { $ErrorActionPreference = $old; Write-Host "$($p.Name): already applied, skipped." -ForegroundColor Green; continue }
    & git apply --ignore-whitespace --check $p.FullName
    if ($LASTEXITCODE -ne 0) { $ErrorActionPreference = $old; throw "$($p.Name) does not fit this LiveChat folder (it may be another version, or an earlier patch is missing). Copy the lines above and send them." }
    & git apply --ignore-whitespace $p.FullName
    if ($LASTEXITCODE -ne 0) { $ErrorActionPreference = $old; throw "Applying $($p.Name) failed." }
    $ErrorActionPreference = $old
    Write-Host "$($p.Name): applied." -ForegroundColor Green
  }
  Write-Host 'Done. Now rebuild and restart LiveChat with setup-nodocker.ps1 (see the top of this file).' -ForegroundColor Green
} finally { Pop-Location }
