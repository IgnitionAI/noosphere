import { createNoosphereApiRuntime } from "@outbound/bootstrap/create-noosphere-api-runtime";

const port = positiveIntegerEnvironment("PORT", 3000);
const runtime = createNoosphereApiRuntime(process.env);
const server = Bun.serve({
  port,
  // F-022 CSV uploads are accepted up to 10 MiB; leave headroom for JSON/multipart overhead.
  maxRequestBodySize: 12 * 1024 * 1024,
  fetch(request) {
    return runtime.handle(request);
  },
  error() {
    return Response.json(
      {
        type: "https://ignition-outbound.local/problems/internal_error",
        title: "INTERNAL_ERROR",
        status: 500,
        detail: "An unexpected error occurred",
        code: "INTERNAL_ERROR",
      },
      {
        status: 500,
        headers: { "content-type": "application/problem+json; charset=utf-8" },
      },
    );
  },
});

console.info(JSON.stringify({ event: "api_started", port: server.port }));
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, async () => {
    console.info(JSON.stringify({ event: "api_stopping", signal }));
    server.stop();
    await runtime.close();
    console.info(JSON.stringify({ event: "api_stopped" }));
  });
}

function positiveIntegerEnvironment(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}
