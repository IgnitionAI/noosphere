import type { NextRequest } from "next/server";
import { outboundApiUrl } from "@/lib/api";

export const dynamic = "force-dynamic";

async function proxyAuth(
  request: NextRequest,
  context: { params: Promise<{ all: string[] }> },
): Promise<Response> {
  const { all } = await context.params;
  const target = outboundApiUrl(`/api/auth/${all.join("/")}`);
  target.search = request.nextUrl.search;
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");

  const upstream = await fetch(target, {
    method: request.method,
    headers,
    ...(request.method === "GET" || request.method === "HEAD"
      ? {}
      : { body: await request.arrayBuffer() }),
    redirect: "manual",
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: upstream.headers,
  });
}

export const GET = proxyAuth;
export const POST = proxyAuth;
