import { outboundApiUrl } from "@/lib/api";

export async function GET(
  request: Request,
  context: { params: Promise<{ onboardingId: string }> },
): Promise<Response> {
  const { onboardingId } = await context.params;
  const source = new URL(request.url);
  const target = outboundApiUrl(`/api/v1/connected-accounts/onboarding/${encodeURIComponent(onboardingId)}/callback`);
  target.search = source.search;
  const upstream = await fetch(target, { method: "GET", redirect: "manual", cache: "no-store" });
  const headers = new Headers();
  const contentType = upstream.headers.get("content-type");
  const location = upstream.headers.get("location");
  if (contentType) headers.set("content-type", contentType);
  if (location) headers.set("location", location);
  return new Response(upstream.body, { status: upstream.status, headers });
}
