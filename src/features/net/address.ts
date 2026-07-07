// Tailscale assigns 100.64.0.0/10 IPv4 addresses (CGNAT range, always "100.")
// and fd7a:115c:a1e0::/48 IPv6 ULA addresses to tailnet peers. A peer reachable
// only over Tailscale must be treated as source "tailscale" so reconnects target
// the right route.

export function isTailscaleAddress(host: string | undefined): boolean {
  if (!host) {
    return false;
  }
  const normalized = host.trim().toLowerCase().replace(/^\[/, "");
  return normalized.startsWith("100.") || normalized.startsWith("fd7a:115c:a1e0");
}
