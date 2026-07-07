import { describe, expect, it } from "vitest";
import { isTailscaleAddress } from "./address";

describe("isTailscaleAddress", () => {
  it("detects Tailscale IPv4 CGNAT addresses", () => {
    expect(isTailscaleAddress("100.100.123.107")).toBe(true);
    expect(isTailscaleAddress("100.64.0.1")).toBe(true);
  });

  it("detects Tailscale IPv6 ULA addresses (with or without brackets)", () => {
    expect(isTailscaleAddress("fd7a:115c:a1e0::6e01:7b7d")).toBe(true);
    expect(isTailscaleAddress("[fd7a:115c:a1e0::6e01:7b7d]")).toBe(true);
    expect(isTailscaleAddress("FD7A:115C:A1E0::1")).toBe(true);
  });

  it("treats LAN and other addresses as non-Tailscale", () => {
    expect(isTailscaleAddress("192.168.64.51")).toBe(false);
    expect(isTailscaleAddress("10.0.0.2")).toBe(false);
    expect(isTailscaleAddress("101.0.0.1")).toBe(false);
    expect(isTailscaleAddress(undefined)).toBe(false);
    expect(isTailscaleAddress("")).toBe(false);
  });
});
