import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { checkServerIdentity, type PeerCertificate } from "node:tls";

type Address = { address: string; family: number };
type Resolver = (host: string) => Promise<readonly Address[]>;
const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(network, prefix, "ipv4");
const ipv6Global = new BlockList();
ipv6Global.addSubnet("2000::", 3, "ipv6");
blocked.addSubnet("2001::", 23, "ipv6");
blocked.addSubnet("2001:db8::", 32, "ipv6");
blocked.addSubnet("2002::", 16, "ipv6");
blocked.addSubnet("3fff::", 20, "ipv6");
export class ProviderDestinationForbiddenError extends Error { constructor() { super("AI_PROVIDER_DESTINATION_FORBIDDEN"); } }
function forbidden(): never { throw new ProviderDestinationForbiddenError(); }
function isPublic(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? !blocked.check(address, "ipv4")
    : family === 6 && ipv6Global.check(address, "ipv6") && !blocked.check(address, "ipv6");
}
export function parseProviderDestination(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { return forbidden(); }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.port
    || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")
    || (!isIP(hostname) && !hostname.includes(".")) || (isIP(hostname) && !isPublic(hostname))) return forbidden();
  return url;
}
export async function resolveProviderDestination(value: string, resolver: Resolver = (host) => lookup(host, { all: true })) {
  const url = parseProviderDestination(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await resolver(hostname);
  if (!addresses.length || addresses.some(({ address }) => !isPublic(address))) return forbidden();
  const selected = addresses.find(({ family }) => family === 4) ?? addresses[0]!;
  return { url, address: selected.address, family: selected.family };
}

/** Re-resolve every invocation, reject mixed DNS, and pin the validated IP to the TLS socket.
 * The original hostname remains the Host header and TLS certificate identity. No redirects.
 */
export async function fetchPublicProvider(value: string, options: RequestInit = {}): Promise<Response> {
  const signal = options.signal ?? AbortSignal.timeout(30_000);
  signal.throwIfAborted();
  const destination = await new Promise<Awaited<ReturnType<typeof resolveProviderDestination>>>((resolve, reject) => {
    const abort = () => reject(new Error("AI_PROVIDER_ABORTED"));
    signal.addEventListener("abort", abort, { once: true });
    resolveProviderDestination(value).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
  signal.throwIfAborted();
  const target = new URL(destination.url);
  target.hostname = destination.family === 6 ? `[${destination.address}]` : destination.address;
  const headers = new Headers(options.headers);
  headers.set("host", destination.url.host);
  // Bun 1.3.4's node:https custom lookup path fails TLS connections. Dial the
  // validated IP directly instead, retaining SNI and explicit hostname verification.
  const response = await fetch(target, {
    ...options, headers, signal, redirect: "error", keepalive: false,
    proxy: "",
    tls: {
      serverName: destination.url.hostname.replace(/^\[|\]$/g, ""),
      rejectUnauthorized: true,
      checkServerIdentity: (_hostname: string, certificate: PeerCertificate) => checkServerIdentity(destination.url.hostname.replace(/^\[|\]$/g, ""), certificate),
    },
  });
  if (!response.ok) { await response.body?.cancel(); return new Response(null, { status: response.status }); }
  const reader = response.body?.getReader();
  if (!reader) return new Response(null, { status: response.status });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { value: chunk, done } = await reader.read();
      if (done) break;
      bytes += chunk.length;
      if (bytes > 16 * 1024 * 1024) { await reader.cancel(); throw new Error("AI_PROVIDER_RESPONSE_TOO_LARGE"); }
      chunks.push(chunk);
    }
  } finally { reader.releaseLock(); }
  return new Response(Buffer.concat(chunks), { status: response.status });
}
