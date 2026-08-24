export function outboundApiUrl(pathname: string): URL {
  if (
    !pathname.startsWith("/api/")
    || pathname.startsWith("//")
    || pathname.includes("#")
    || /[\\\u0000-\u001f\u007f]/.test(pathname)
  ) {
    throw new Error("INVALID_OUTBOUND_API_PATH");
  }

  const base = new URL(process.env.OUTBOUND_API_URL ?? "http://127.0.0.1:3001");
  if (
    (base.protocol !== "http:" && base.protocol !== "https:")
    || base.username
    || base.password
    || base.search
    || base.hash
  ) {
    throw new Error("INVALID_OUTBOUND_API_URL");
  }

  const queryOffset = pathname.indexOf("?");
  const target = new URL(base.origin);
  target.pathname = queryOffset === -1 ? pathname : pathname.slice(0, queryOffset);
  target.search = queryOffset === -1 ? "" : pathname.slice(queryOffset + 1);
  return target;
}
