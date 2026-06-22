# Performance Validation

KunoChat optimizes the direct peer path: instant control messages use a separate WebRTC channel from file bytes, and native file I/O keeps chunks binary. That reduces avoidable local work; it does not override the speed of a user's network or guarantee a universal win over every service.

## Metrics

Measure these values with two installed release builds, recording p50 and p95 for at least 100 text sends and three runs per file size:

- Text delivery latency: tap Send to peer render.
- Text acknowledgement latency: tap Send to sender `received` status.
- Connection ready time: both apps opened to both DataChannels open.
- First-byte time: peer requests an asset to first binary chunk written locally.
- Sustained throughput: received bytes divided by transfer duration, excluding setup time.
- Recovery time: network interruption to resumed bytes, plus final SHA-256 verification time.

## Required Matrix

| Scenario | Text samples | Files |
| --- | ---: | --- |
| Same Wi-Fi/LAN, macOS to Windows | 100 each direction | 10 MB, 100 MB, 1 GB |
| Same Wi-Fi/LAN, macOS to macOS | 100 each direction | 10 MB, 100 MB, 1 GB |
| Same Tailscale tailnet, macOS to Windows | 100 each direction | 10 MB, 100 MB |
| Interrupted transfer resume | 10 each direction | 100 MB, interrupt at 25%, 50%, 75% |

## Pass Criteria

- No text message loss or duplicate render.
- No file checksum mismatch, size mismatch, or false `received` state.
- No control-message stall while a 1 GB binary transfer is active.
- Record hardware, OS version, Wi-Fi/Ethernet condition, Tailscale relay/direct path, and available bandwidth with every result.
- Treat a regression of more than 10% from the established p95 baseline as a release blocker until explained.

## Current Implementation Constraints

- The sender and receiver communicate directly only when WebRTC establishes a viable route. TURN infrastructure is still required to guarantee remote NAT traversal.
- Durable sender-side byte-range resume across a full application restart is not complete yet. Same-process reconnect re-announces pending assets; a crash-safe resume protocol remains a release blocker for large-file reliability.
- Benchmark conclusions must be based on the matrix above, not a single local-machine run.
