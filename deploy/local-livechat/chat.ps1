# Sends one visitor message into the LOCAL LiveChat and prints the bot's reply.
# Usage:  powershell -File deploy\local-livechat\chat.ps1 "how to deposit"
param([Parameter(Mandatory = $true)][string]$Text, [string]$Visitor = 'vis-local-0001')
$h = @{ 'X-Tenant-ID' = '1' }
$base = 'http://localhost:8080/widget/conversations'
$cur = $null
try { $cur = Invoke-RestMethod "$base/current?visitor_session_id=$Visitor" -Headers $h } catch { }
$id = $cur.conversation.publicId
$msg = @{ visitor_session_id = $Visitor; visitor_name = 'Tester'; body = $Text; member_external_id = 'm-100'; member_name = 'Tester'; member_rank = 'GOLD' } | ConvertTo-Json
if ($id) { Invoke-RestMethod "$base/$id/messages" -Method Post -Headers $h -ContentType 'application/json' -Body $msg | Out-Null }
else { $id = (Invoke-RestMethod $base -Method Post -Headers $h -ContentType 'application/json' -Body $msg).conversation.publicId }
Start-Sleep 5
$c = (Invoke-RestMethod "$base/$id`?visitor_session_id=$Visitor" -Headers $h).conversation
"Status: $($c.status) / $($c.aiHandoffStatus)"
$c.messages | ForEach-Object { "[$($_.senderType)] $($_.body)" }
