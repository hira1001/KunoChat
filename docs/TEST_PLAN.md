# Test Plan

KunoChat uses automated unit/integration tests plus manual two-device system tests. The current automated suite covers 179 cases: 145 Vitest cases and 34 Cargo cases.

## Automated Evidence

- `npm test`: 145 passed.
- `cargo test`: 34 passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.

## Scope

- Unit: formatting, sendable detection, queue ordering, binary frame encoding, Zustand state transitions, Rust pure logic.
- Integration: standalone WebSocket signaling server with real `ws` clients.
- Native config: verifies normal OS titlebar/window behavior through `tauri.conf.json`.
- System/manual: two physical computers, firewall prompts, LAN discovery, real WebRTC transfer, OS install flows.

## 100 Core Cases

| ID | Level | Area | Case | Expected |
| --- | --- | --- | --- | --- |
| TC-001 | Unit | Format | Format 0 bytes | `0 B` |
| TC-002 | Unit | Format | Format 1 byte | `1 B` |
| TC-003 | Unit | Format | Format 1024 bytes | `1.0 KB` |
| TC-004 | Unit | Format | Format MB values | readable MB label |
| TC-005 | Unit | Format | Format GB values | readable GB label |
| TC-006 | Unit | File label | Image mime | `IMG` |
| TC-007 | Unit | File label | PDF extension | `PDF` |
| TC-008 | Unit | File label | Office docx/xlsx/pptx | normalized labels |
| TC-009 | Unit | File label | Code extensions | `CODE` |
| TC-010 | Unit | File label | Audio/video extensions | media labels |
| TC-011 | Unit | Sendables | HTTPS URL | `link` |
| TC-012 | Unit | Sendables | HTTP URL | `link` |
| TC-013 | Unit | Sendables | Non-http URL | `text` |
| TC-014 | Unit | Sendables | Plain text | `text` |
| TC-015 | Unit | Sendables | Multiline code-like text | `code` |
| TC-016 | Unit | Sendables | Empty text | `text` |
| TC-017 | Unit | Sendables | Image file attachment | `image` |
| TC-018 | Unit | Sendables | PDF attachment | `file` |
| TC-019 | Unit | Sendables | Unknown mime attachment | `file` |
| TC-020 | Unit | Drop | Multiple dropped files | same number of draft attachments |
| TC-021 | Unit | Drop | Dropped image preview | object URL exists |
| TC-022 | Unit | Drop | Dropped non-image preview | no preview |
| TC-023 | Unit | Drop | Dropped file metadata | name/size/mime retained |
| TC-024 | Unit | Drop | Empty mime fallback | `application/octet-stream` |
| TC-025 | Unit | Clipboard | Non-file item | ignored |
| TC-026 | Unit | Clipboard | Null file item | ignored |
| TC-027 | Unit | Clipboard | Pasted image | image draft attachment |
| TC-028 | Unit | Clipboard | Pasted document | file draft attachment |
| TC-029 | Unit | Clipboard | Unnamed pasted image | screenshot fallback name |
| TC-030 | Unit | Clipboard | Pasted image preview | object URL exists |
| TC-031 | Unit | Queue | Instant before normal | instant first |
| TC-032 | Unit | Queue | High before normal | high first |
| TC-033 | Unit | Queue | Normal before low | normal first |
| TC-034 | Unit | Queue | Same priority | older createdAt first |
| TC-035 | Unit | Queue | Sort immutability | input array unchanged |
| TC-036 | Unit | Queue | Instant text item | priority instant |
| TC-037 | Unit | Queue | New queue status | queued |
| TC-038 | Unit | Queue | New queue bytes | zero progress/bytes |
| TC-039 | Unit | Realtime binary | Small payload round trip | id and bytes preserved |
| TC-040 | Unit | Realtime binary | Empty payload round trip | empty bytes preserved |
| TC-041 | Unit | Realtime binary | Unicode transfer id | id preserved |
| TC-042 | Unit | Realtime binary | Long transfer id | id preserved |
| TC-043 | Unit | Realtime binary | Frame header | id length stored |
| TC-044 | Unit | Realtime binary | Payload offset | payload follows id |
| TC-045 | Unit | Realtime binary | Independent frames | no cross-frame bleed |
| TC-046 | Unit | Store | Initial main view | `main` |
| TC-047 | Unit | Store | Change view | selected view saved |
| TC-048 | Unit | Store | Change connection status | status saved |
| TC-049 | Unit | Store | Typing state | boolean saved |
| TC-050 | Unit | Store | Draft state | text saved |
| TC-051 | Unit | Store | Add attachment | attachment appended |
| TC-052 | Unit | Store | Remove attachment | matching id removed |
| TC-053 | Unit | Store | Clear attachments | list empty |
| TC-054 | Unit | Store | Empty draft send | no message |
| TC-055 | Unit | Store | Disconnected send | local system failure |
| TC-056 | Unit | Store | Connected text send without transport | optimistic then failed |
| TC-057 | Unit | Store | Connected text send with transport | sent |
| TC-058 | Unit | Store | Transport rejection | failed |
| TC-059 | Unit | Store | Send clears draft | draft empty |
| TC-060 | Unit | Store | Single file send | file message |
| TC-061 | Unit | Store | Single image send | image message |
| TC-062 | Unit | Store | Text plus attachment | bundle with caption |
| TC-063 | Unit | Store | Multiple attachments | bundle count/size |
| TC-064 | Unit | Store | Duplicate peer text | ignored |
| TC-065 | Unit | Store | Peer display name | updated |
| TC-066 | Unit | Store | Receive peer asset | receiving state created |
| TC-067 | Unit | Store | Transfer progress | message/state updated |
| TC-068 | Unit | Store | Complete received transfer | status received, path retained |
| TC-069 | Unit | Store | Failed transfer | error retained |
| TC-070 | Unit | Store | Settings merge | existing values retained |
| TC-071 | Unit | Store | Clear history | messages empty |
| TC-072 | Integration | Signal server | First peer joins | empty peers list |
| TC-073 | Integration | Signal server | Second peer joins | sees first peer |
| TC-074 | Integration | Signal server | Peer joined event | first peer notified |
| TC-075 | Integration | Signal server | Offer relay | delivered to other peer |
| TC-076 | Integration | Signal server | Answer relay | delivered to other peer |
| TC-077 | Integration | Signal server | ICE relay | delivered to other peer |
| TC-078 | Integration | Signal server | Invalid JSON | error returned |
| TC-079 | Integration | Signal server | Signal before join | error returned |
| TC-080 | Integration | Signal server | Missing join fields | error returned |
| TC-081 | Integration | Signal server | Third peer in room | rejected |
| TC-082 | Native config | Window | OS decorations | enabled |
| TC-083 | Native config | Window | Transparency | disabled |
| TC-084 | Native config | Window | Resize | enabled |
| TC-085 | Native config | Window | Default size | practical desktop size |
| TC-086 | Native config | Window | Minimum size | usable small size |
| TC-087 | Native config | Window | Always on top | off by default |
| TC-088 | Rust unit | Signal server | Normalize dashed code | digits only |
| TC-089 | Rust unit | Signal server | Normalize long code | six digits |
| TC-090 | Rust unit | Signal server | Normalize letters | removed |
| TC-091 | Rust unit | Signal server | First room join | no peers |
| TC-092 | Rust unit | Signal server | Second room join | first peer summary |
| TC-093 | Rust unit | Signal server | Third peer | rejected |
| TC-094 | Rust unit | Signal server | Same peer rejoin | allowed |
| TC-095 | Rust unit | Signal server | Leave room | empty room removed |
| TC-096 | Rust unit | Discovery | IPv4 ordering | numeric order preserved |
| TC-097 | Rust unit | Discovery | Room id symmetry | pair order independent |
| TC-098 | Rust unit | Discovery | Room id shape | six digits |
| TC-099 | Rust unit | Discovery | Discovery JSON | camelCase payload |
| TC-100 | Rust unit | Discovery | Auto-connect JSON | UI event payload shape |
| TC-101 | Unit | Hash | Empty payload SHA-256 | known digest |
| TC-102 | Unit | Hash | Text payload SHA-256 | known digest |
| TC-103 | Unit | Hash | Native path asset hashing | calls native command |
| TC-104 | Unit | Hash | Browser File hashing | hash returned |
| TC-105 | Unit | Hash | Missing readable source | undefined |
| TC-106 | Rust unit | Tailscale | No online peer | no candidate |
| TC-107 | Rust unit | Tailscale | Online peer | candidate selected |
| TC-108 | Rust unit | Tailscale | Offline peer | ignored |
| TC-109 | Rust unit | Tailscale | Lower local ID | host mode |
| TC-110 | Rust unit | Tailscale | Higher local ID | join mode |
| TC-111 | Rust unit | Tailscale | Room id | symmetric |
| TC-112 | Rust unit | Tailscale | Status JSON | parses `ID`/`DNSName`/`TailscaleIPs` |
| TC-113 | Unit | Transfer | Late SHA-256 | stored on completed transfer |
| TC-114 | Unit | RTC policy | Control channel | unordered reliable lane |
| TC-115 | Unit | RTC policy | Binary channel | ordered file lane |
| TC-116 | Unit | Transfer limits | Chunk size | 256 KiB chunks |
| TC-117 | Unit | Transfer limits | Backpressure | low threshold below max |
| TC-118 | Rust unit | Discovery | New LAN peer | emitted immediately |
| TC-119 | Rust unit | Discovery | Repeated LAN peer | suppressed inside reemit window |
| TC-120 | Rust unit | Discovery | Repeated LAN peer after window | reemitted |
| TC-121 | Rust unit | Tailscale | New candidate | emitted immediately |
| TC-122 | Rust unit | Tailscale | Repeated candidate | suppressed inside reemit window |
| TC-123 | Rust unit | Tailscale | Repeated candidate after window | reemitted |

## Manual System Cases

These require two physical machines and cannot be fully proven from a single Codex runtime.

| ID | Scenario | Expected |
| --- | --- | --- |
| SYS-001 | Open installed app on Mac and Windows on same home LAN | no terminal command required |
| SYS-002 | Accept first-run firewall prompts | peer discovery continues |
| SYS-003 | Type on one PC | other PC shows typing quickly |
| SYS-004 | Send text | sender sees optimistic message immediately; receiver receives it |
| SYS-005 | Send file while typing | text/typing control remains responsive |
| SYS-006 | Send multiple-file bundle | all files arrive and save under `Downloads/KunoChat` |
| SYS-007 | Close/reopen one app | reconnect or clear offline state without fake messages |
| SYS-008 | Windows installer artifact | app opens with normal titlebar |
| SYS-009 | macOS DMG artifact | app opens with normal titlebar |
| SYS-010 | Guest/isolated Wi-Fi | app does not falsely claim connection if LAN peer traffic is blocked |
| SYS-011 | Two remote computers with Tailscale | both open KunoChat and connect without entering an IP |
| SYS-012 | Tailscale installed on only one computer | app stays in clear waiting/failed state |
