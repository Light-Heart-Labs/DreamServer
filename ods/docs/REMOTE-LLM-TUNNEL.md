# Remote LLM Tunnel

ODS can run the dashboard, Hermes, Open WebUI, voice, search, and workflows on
a laptop while sending LLM inference to a larger workstation. The supported
path is an SSH local-forward to a remote OpenAI-compatible server such as vLLM,
llama.cpp server, Lemonade, LocalAI, or any endpoint with `/v1/models` and
`/v1/chat/completions`.

This keeps the remote workstation unchanged: ODS only opens an SSH session from
the laptop and forwards a laptop loopback port to the remote loopback port.

## When To Use This

Use this mode when:

- The laptop should remain the ODS control surface.
- A workstation has the better GPU or already hosts the preferred model.
- The remote server already exposes an OpenAI-compatible API on its own host.
- You want the route to recover after laptop sleep, reboot, or conference Wi-Fi
  reconnects.

Do not use this as a public network exposure mechanism. The tunnel binds to
`127.0.0.1` by default and should stay loopback-only.

## Remote Host Prerequisites

On the workstation, verify the model server from the workstation itself:

```bash
curl -fsS http://127.0.0.1:8000/v1/models
curl -fsS http://127.0.0.1:8000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"your-model-id","messages":[{"role":"user","content":"reply exactly: ready"}],"max_tokens":16,"temperature":0}'
```

The workstation does not need to expose this port to the LAN. The ODS laptop
only needs key-based SSH access to the workstation.

## Configure ODS On Windows

From the installed ODS directory:

```powershell
cd $env:USERPROFILE\ods

powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\configure-remote-llm.ps1 `
  -UseSshTunnel `
  -SshHost workstation-ssh `
  -RemotePort 8000 `
  -LocalPort 18080 `
  -Model your-model-id `
  -Context 65536 `
  -RegisterTask
```

Replace `workstation-ssh`, `8000`, and `your-model-id` with your SSH alias,
remote server port, and served model id. The helper:

- backs up `.env`, `.compose-flags`, LiteLLM configs, and Hermes configs under
  `logs/remote-llm-backup-*`;
- switches ODS to cloud/external inference mode;
- points ODS clients at `http://host.docker.internal:<local-port>`;
- updates Hermes's persisted config, not only its env vars;
- writes the cloud compose overlay into `.compose-flags` so local
  `llama-server` is profiled out;
- registers the `ODS Remote LLM Tunnel` scheduled task when `-RegisterTask` is
  set.

Then recreate the stack:

```powershell
$flags = (Get-Content .compose-flags -Raw).Trim() -split '\s+'
docker compose @flags up -d --remove-orphans --no-build
docker rm -f ods-llama-server
```

The `docker rm -f` is intentional when migrating an existing local install:
old local inference containers can otherwise keep running even though they are
no longer in the active compose stack.

## Start And Validate

Start the tunnel immediately:

```powershell
Start-ScheduledTask -TaskName "ODS Remote LLM Tunnel"
```

Validate:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-remote-llm.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\ods.ps1 doctor
```

The validation script checks the host tunnel, container reachability, optional
LiteLLM chat, and confirms the local `ods-llama-server` is not still running.

Useful state checks:

```powershell
Get-ScheduledTask -TaskName "ODS Remote LLM Tunnel"
Get-NetTCPConnection -LocalPort 18080 -State Listen
Get-Content .\logs\remote-llm-tunnel.log -Tail 30
```

## Direct Remote Endpoint Without SSH

If the remote API is already reachable from ODS containers, omit
`-UseSshTunnel` and pass the container-reachable host root:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\configure-remote-llm.ps1 `
  -EndpointRoot http://llm-workstation.local:8000 `
  -Model your-model-id `
  -Context 65536
```

Prefer SSH for workstation-local vLLM and laptop workflows because it keeps the
inference server private and avoids firewall/LAN binding surprises.

## Port Conflicts

Windows may already have a local service on a port you expect ODS to use. For
example, Lemonade can own `127.0.0.1:9000`, which makes host-side Whisper
checks hang even if Docker publishes `0.0.0.0:9000`.

Check ownership:

```powershell
Get-NetTCPConnection -LocalPort 9000 -State Listen |
  Select-Object LocalAddress,LocalPort,OwningProcess,
    @{Name='ProcessName';Expression={(Get-Process -Id $_.OwningProcess).ProcessName}}
```

If needed, set a different host port before recreating the stack:

```powershell
.\scripts\configure-remote-llm.ps1 -UseSshTunnel -SshHost workstation-ssh -Model your-model-id -WhisperPort 9001
```

Containers still use `whisper:8000`; this only changes the host-facing port.

## Rollback

Disable the task:

```powershell
Disable-ScheduledTask -TaskName "ODS Remote LLM Tunnel"
```

Stop the tracked SSH tunnel:

```powershell
$pidFile = ".\logs\remote-llm-tunnel.pid"
if (Test-Path $pidFile) {
  Stop-Process -Id ([int](Get-Content $pidFile -Raw)) -Force
}
```

Restore the latest backup under `logs/remote-llm-backup-*`, then recreate the
stack with the restored `.compose-flags`.

## Notes For Reviewers

This mode intentionally reuses the cloud overlay instead of adding another
compose backend. The overlay profiles managed local `llama-server` out of the
default stack, while the normal ODS services keep reading `LLM_API_URL`,
`HERMES_LLM_BASE_URL`, and `ODS_TALK_VISION_URL`.

`ods doctor` treats `REMOTE_LLM_TUNNEL_ENABLED=true` plus a matching
`host.docker.internal:<local-port>` route as an intentional direct remote
route. Ordinary cloud installs still warn when they bypass the LiteLLM gateway.
