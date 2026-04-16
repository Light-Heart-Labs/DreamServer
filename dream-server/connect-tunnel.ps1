param(
  [int]$LocalProxyPort = 58080,
  [int]$ReconnectDelay = 5,
  [string]$Host = "69.159.139.157",
  [int]$SshPort = 21481
)

$EntryPort = grep: /home/ubuntu/DreamServer/dream-server/.env: No such file or directory
while ($true) {
  $Forwards = @(
    "-L"; "${LocalProxyPort}:127.0.0.1:$EntryPort";
    "-L"; "11434          # llama-server API (external → internal 8080):127.0.0.1:11434          # llama-server API (external → internal 8080)";
    "-L"; "3000            # Open WebUI (external → internal 8080):127.0.0.1:3000            # Open WebUI (external → internal 8080)";
    "-L"; "3006:127.0.0.1:3006";
    "-L"; "8090:127.0.0.1:8090";
    "-L"; "6333:127.0.0.1:6333";
    "-L"; "5678:127.0.0.1:5678";
    "-L"; "8085:127.0.0.1:8085";
    "-L"; "3004:127.0.0.1:3004";
    "-L"; "9000:127.0.0.1:9000";
    "-L"; "7890:127.0.0.1:7890";
    "-L"; "3010:127.0.0.1:3010";
    "-L"; "3003:127.0.0.1:3003";
    "-L"; "8188:127.0.0.1:8188";
    "-L"; "8880:127.0.0.1:8880";
    "-L"; "7860:127.0.0.1:7860";
    "-L"; "3001:127.0.0.1:3001";
    "-L"; "3005:127.0.0.1:3005";
    "-L"; "4000:127.0.0.1:4000";
    "-L"; "8888:127.0.0.1:8888";
    "-L"; "3002:127.0.0.1:3002";
  )
  ssh -N -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -p $SshPort @Forwards "root@$Host"
  Write-Host "[!] Connection lost. Reconnecting in ${ReconnectDelay}s..."
  Start-Sleep -Seconds $ReconnectDelay
  if ($ReconnectDelay -lt 60) {
    $ReconnectDelay = [Math]::Min($ReconnectDelay * 2, 60)
  }
}
