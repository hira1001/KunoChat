# Network Debug: HomeDesktop Connection Failure

Date: 2026-07-06

## Scope

This debug pass focused only on network reachability:

- Local KunoChat process and bound ports
- Windows Firewall profile/rules
- LAN address reachability
- Tailscale peer reachability
- TCP port reachability for KunoChat signaling/file-transfer ports
- WebSocket-level KunoChat signaling probe

## Local Device

- Device: `XPS-Notebook`
- Installed KunoChat: `0.6.2`
- Process: `kunochat.exe`
- Path: `C:\Users\ymy26\AppData\Local\KunoChat\kunochat.exe`
- Local IPv4 addresses:
  - Wi-Fi: `192.168.64.79/23`
  - Tailscale: `100.87.112.32/32`
- Network profile:
  - Wi-Fi: `Public`
  - Tailscale: `Private`

## Local Listener Verification

KunoChat is listening locally:

| Protocol | Address | Port | Result |
| --- | --- | ---: | --- |
| TCP | `0.0.0.0` | `8787` | listening |
| TCP | `0.0.0.0` | `8790` | listening |
| UDP | `0.0.0.0` | `8788` | listening |

Local TCP reachability also passed:

| Target | Port | Result |
| --- | ---: | --- |
| `127.0.0.1` | `8787` | reachable |
| `127.0.0.1` | `8790` | reachable |
| `192.168.64.79` | `8787` | reachable |
| `192.168.64.79` | `8790` | reachable |
| `100.87.112.32` | `8787` | reachable |
| `100.87.112.32` | `8790` | reachable |

Local WebSocket signaling probe passed:

```text
ws://127.0.0.1:8787 -> {"requestId":"network-debug","type":"connection-request-ack"}
```

## Firewall Verification

Windows Firewall is enabled and defaults to inbound block.

KunoChat has explicit inbound allow rules:

| Program | Direction | Action | Profile |
| --- | --- | --- | --- |
| `C:\users\ymy26\appdata\local\kunochat\kunochat.exe` | Inbound | Allow | Private, Public |
| `C:\users\ymy26\appdata\local\kunochat\kunochat.exe` | Inbound | Allow | Private, Public |

Local conclusion: this PC is not the network bottleneck for inbound KunoChat traffic.

## Remote Peer

The active remote peer is:

- Host: `HomeDesktop`
- MagicDNS: `homedesktop.tailc8c15b.ts.net`
- Tailscale IPv4: `100.100.123.107`
- LAN IPv4 observed by Tailscale: `192.168.64.51`
- OS: Windows
- Tailscale status: online
- Tailscale direct path: active

Tailscale peer ping passed:

```text
pong from homedesktop (100.100.123.107) via 192.168.64.51:41641 in 2ms
```

Tailscale PeerAPI also responded over TCP:

| Target | Port | Result |
| --- | ---: | --- |
| `100.100.123.107` | `41475` | TCP open / HTTP 200 |

This proves Tailscale routing and TCP transport to the peer are working.

## Remote KunoChat Port Failure

KunoChat-specific ports on `HomeDesktop` are not reachable:

| Target | Port | Purpose | Result |
| --- | ---: | --- | --- |
| `100.100.123.107` | `8787` | KunoChat signaling WebSocket | timeout / closed |
| `100.100.123.107` | `8790` | KunoChat native transfer TCP | timeout / closed |
| `192.168.64.51` | `8787` | KunoChat signaling WebSocket | timeout / closed |
| `192.168.64.51` | `8790` | KunoChat native transfer TCP | timeout / closed |

WebSocket-level remote probes also failed before receiving any KunoChat response:

```text
ws://100.100.123.107:8787 -> timeout
ws://192.168.64.51:8787 -> timeout
```

## Conclusion

The current connection failure is not caused by this PC's local KunoChat listener, local firewall rule, Tailscale installation, MagicDNS, or general Tailscale TCP transport.

The failure is isolated to the remote Windows peer `HomeDesktop`:

1. `HomeDesktop` is online in Tailscale.
2. `HomeDesktop` responds to Tailscale ping.
3. `HomeDesktop` responds on its Tailscale PeerAPI TCP port.
4. `HomeDesktop` does not respond on KunoChat ports `8787` or `8790`.

Most likely causes on `HomeDesktop`:

1. KunoChat is not running.
2. KunoChat is running but is not version `0.6.2`.
3. KunoChat failed to bind `0.0.0.0:8787` or `0.0.0.0:8790`.
4. Windows Firewall or security software on `HomeDesktop` is blocking inbound KunoChat.
5. `HomeDesktop` is running a stale installed binary from a different path without matching firewall allow rules.

## Required Remote Checks

Run these on `HomeDesktop`:

```powershell
(Get-Item "$env:LOCALAPPDATA\KunoChat\kunochat.exe").VersionInfo | Select-Object FileVersion,ProductVersion,FileName
Get-Process kunochat -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,Path
Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 8787,8790 } | Select-Object LocalAddress,LocalPort,State,OwningProcess
Get-NetUDPEndpoint | Where-Object { $_.LocalPort -eq 8788 } | Select-Object LocalAddress,LocalPort,OwningProcess
Get-NetFirewallApplicationFilter | Where-Object { $_.Program -like '*kunochat*' } | ForEach-Object { $rule = Get-NetFirewallRule -AssociatedNetFirewallApplicationFilter $_; [pscustomobject]@{DisplayName=$rule.DisplayName; Enabled=$rule.Enabled; Direction=$rule.Direction; Action=$rule.Action; Profile=$rule.Profile; Program=$_.Program} }
```

Expected healthy remote state:

- KunoChat version is `0.6.2`.
- `kunochat.exe` is running from `C:\Users\<user>\AppData\Local\KunoChat\kunochat.exe`.
- TCP `0.0.0.0:8787` is listening.
- TCP `0.0.0.0:8790` is listening.
- UDP `0.0.0.0:8788` is listening.
- Firewall has enabled inbound allow rules for the same `kunochat.exe` path on Private/Public profiles.
