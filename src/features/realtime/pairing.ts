// Deterministic pairing helpers shared by both peers so that, regardless of who
// dials first, both sides converge on the SAME signaling room and complementary
// host/join roles.
//
// `roomIdForPair` is a TypeScript port of `room_id_for_pair` in
// src-tauri/src/native/peer_discovery.rs (FNV-1a 32-bit). Peer ids match
// /^[A-Za-z0-9_-]{1,128}$/, so JavaScript string `<=` comparison and Rust's
// byte-wise comparison agree. The Rust and TS implementations MUST stay in sync;
// cross-language fixtures lock the values (see pairing.test.ts and the Rust
// `room_id_for_pair_known_vector` test).

export function roomIdForPair(left: string, right: string): string {
  const [first, second] = left <= right ? [left, right] : [right, left];
  let hash = 2166136261 >>> 0;
  for (const byte of new TextEncoder().encode(first + second)) {
    hash = (hash ^ byte) >>> 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return String(hash % 1_000_000).padStart(6, "0");
}

// Host is the lexicographically smaller stable id. This mirrors discovery, which
// makes the lower IP the host (peer_discovery.rs:100-105).
export function roleForPair(localId: string, remoteId: string): "host" | "join" {
  return localId < remoteId ? "host" : "join";
}
