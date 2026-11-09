/**
 * RazorShield AI — outbound URL guard for operator-supplied endpoints.
 *
 * The AI panel lets an operator point the investigator at ANY
 * OpenAI-compatible endpoint. Without a guard, a public deployment turns
 * that into an SSRF primitive: `http://169.254.169.254/...` (cloud
 * metadata), `http://10.0.0.1/...` (internal services) or DNS names that
 * resolve into private ranges could all be probed from the server.
 *
 * This module is the single choke point every server-side LLM call goes
 * through (config save, connection test, model catalogue, chat). It:
 *
 *   1. Enforces http(s) and a hostname length bound.
 *   2. Rejects local/loopback hosts unless the caller explicitly opts in
 *      (only the local Ollama provider does).
 *   3. Resolves DNS and rejects ANY resolved address that is not globally
 *      routable — private, reserved, link-local (incl. cloud metadata)
 *      and IPv6 unique-local / link-local ranges all fail closed.
 *
 * Known limitation (documented honestly): validation happens before the
 * request, so a rebinding DNS record that flips between checks could
 * still rotate to an internal address. Fully closing that requires an
 * outbound proxy with IP pinning — out of scope for a demo deployment,
 * and noted in the README's security section.
 */

import { promises as dns } from "dns";
import net from "net";

export interface UrlGuardOptions {
  /** Allow loopback/private targets — ONLY for the local Ollama provider. */
  allowLocal?: boolean;
}

export class UrlGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UrlGuardError";
  }
}

/** True for hostnames that mean "this machine" without needing DNS. */
function isLocalHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "0.0.0.0" ||
    h === "::1" ||
    h === "[::1]" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local")
  );
}

function ipv4Blocked(ip: string): string | null {
  const parts = ip.split(".").map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return "malformed IPv4 address";
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return "this-block (0.0.0.0/8)";
  if (a === 10) return "private range (10.0.0.0/8)";
  if (a === 127) return "loopback (127.0.0.0/8)";
  if (a === 100 && b >= 64 && b <= 127) return "CGNAT range (100.64.0.0/10)";
  if (a === 169 && b === 254) return "link-local (169.254.0.0/16 — includes cloud metadata 169.254.169.254)";
  if (a === 172 && b >= 16 && b <= 31) return "private range (172.16.0.0/12)";
  if (a === 192 && b === 0 && parts[2] === 0) return "IETF protocol assignments (192.0.0.0/24)";
  if (a === 192 && b === 0 && parts[2] === 2) return "documentation range (192.0.2.0/24)";
  if (a === 192 && b === 168) return "private range (192.168.0.0/16)";
  if (a === 198 && (b === 18 || b === 19)) return "benchmarking range (198.18.0.0/15)";
  if (a === 198 && b === 51 && parts[2] === 100) return "documentation range (198.51.100.0/24)";
  if (a === 203 && b === 0 && parts[2] === 113) return "documentation range (203.0.113.0/24)";
  if (a >= 224) return "multicast / reserved range";
  return null;
}

/** Expand an IPv6 address into its 8 hex groups (best effort). */
function ipv6Groups(ip: string): number[] | null {
  // Node's parser rejects the shorthands we care about? No — parse both
  // plain and zone-less forms by hand: split on "::" once.
  const sections = ip.split("::");
  if (sections.length > 2) return null;
  const head = sections[0] ? sections[0].split(":").filter(Boolean) : [];
  const tail = sections.length === 2 && sections[1] ? sections[1].split(":").filter(Boolean) : [];
  const groups = sections.length === 2 ? [...head, ...Array(8 - head.length - tail.length).fill("0"), ...tail] : head;
  if (groups.length !== 8) return null;
  const nums: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    nums.push(Number.parseInt(g, 16));
  }
  return nums;
}

function ipv6Blocked(ip: string): string | null {
  const lower = ip.toLowerCase();
  // IPv4-mapped IPv6 (::ffff:10.0.0.1 etc., in any spelling) — inspect
  // the embedded v4. WHATWG URL canonicalisation turns ::ffff:10.0.0.1
  // into ::ffff:a00:1, so the hex form must be handled too.
  if (lower.startsWith("::ffff:")) {
    const mapped = lower.slice(7);
    if (net.isIPv4(mapped)) return ipv4Blocked(mapped);
    const groups = ipv6Groups(lower);
    if (groups && groups[0] === 0 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0 && groups[4] === 0 && groups[5] === 0xffff) {
      const hi = (groups[6] >> 8) & 0xff;
      const lo = groups[6] & 0xff;
      return ipv4Blocked(`${hi}.${lo}.${(groups[7] >> 8) & 0xff}.${groups[7] & 0xff}`);
    }
  }
  // General v4-compatibility check via expansion (::a.b.c.d legacy forms
  // and any /96-embedded v4 in the last 32 bits with a zero prefix).
  const groups = ipv6Groups(lower);
  if (groups) {
    const v4 = groups[6] === 0 && groups[7] !== 0 ? null : groups.slice(6);
    if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff && v4) {
      const hi = (v4[0] >> 8) & 0xff;
      const lo = v4[0] & 0xff;
      const r = ipv4Blocked(`${hi}.${lo}.${(v4[1] >> 8) & 0xff}.${v4[1] & 0xff}`);
      if (r) return r;
    }
    if (groups.slice(0, 6).every((g) => g === 0) && groups[6] === 0 && groups[7] !== 0) {
      return "IPv4-compatible IPv6 (::/96)";
    }
  }
  if (lower === "::" || lower === "::1") return "IPv6 unspecified/loopback";
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) {
    return "IPv6 link-local (fe80::/10)";
  }
  if (lower.startsWith("fc") || lower.startsWith("fd")) return "IPv6 unique-local (fc00::/7)";
  if (lower.startsWith("ff")) return "IPv6 multicast";
  // 64:ff9b::/96 (NAT64) can tunnel to internal v4 — conservatively blocked.
  if (lower.startsWith("64:ff9b")) return "NAT64 range (64:ff9b::/96)";
  return null;
}

/** Reject any address that is not globally routable. */
function blockedReason(ip: string): string | null {
  if (net.isIPv4(ip)) return ipv4Blocked(ip);
  if (net.isIPv6(ip)) return ipv6Blocked(ip);
  return "unparseable address";
}

/**
 * Validates an operator-supplied endpoint URL. Returns the parsed URL on
 * success; throws UrlGuardError with a human-readable reason otherwise.
 */
export async function assertSafeLlmUrl(raw: string, opts: UrlGuardOptions = {}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new UrlGuardError("Endpoint is not a valid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UrlGuardError("Only http(s) endpoints are allowed");
  }
  if (url.username || url.password) {
    throw new UrlGuardError("Credentials in the URL are not supported — use the API key field");
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host || host.length > 253) {
    throw new UrlGuardError("Endpoint hostname is missing or too long");
  }

  /* Literal-IP targets are checked directly; hostnames go through DNS
   * below. A hostname string is never an IP, so it must not be fed to
   * blockedReason (which would reject it as "unparseable"). */
  const hostIsIp = net.isIPv4(host) || net.isIPv6(host);
  const local = isLocalHostname(host) || (hostIsIp && blockedReason(host) !== null);
  if (local && !opts.allowLocal) {
    throw new UrlGuardError(
      "Local and private network endpoints are blocked — only the local Ollama provider may target this machine",
    );
  }
  if (local && opts.allowLocal) {
    return url; // explicitly opted in (Ollama) — no DNS needed for loopback
  }

  /* Resolve DNS and fail closed on any non-global address. Literal IPs
   * skip DNS (lookup with all:true passes them through). */
  try {
    const records = await dns.lookup(host, { all: true, verbatim: true });
    if (!records.length) throw new Error("no records");
    for (const r of records) {
      const reason = blockedReason(r.address);
      if (reason) {
        throw new UrlGuardError(
          `Endpoint resolves to a non-routable address (${r.address} — ${reason}). Internal targets are blocked.`,
        );
      }
    }
  } catch (err) {
    if (err instanceof UrlGuardError) throw err;
    throw new UrlGuardError("Endpoint hostname could not be resolved — check the URL");
  }

  return url;
}
