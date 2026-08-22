export interface CodexProcessRequest {
  readonly command: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly stdin: string;
  readonly deadlineAt: Date;
  readonly signal?: AbortSignal;
  readonly maxOutputBytes: number;
}

export interface CodexProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CodexProcessRunner {
  run(request: CodexProcessRequest): Promise<CodexProcessResult>;
}

export class CodexProcessTimedOutError extends Error {
  readonly name = "CodexProcessTimedOutError";
}

export class CodexProcessAbortedError extends Error {
  readonly name = "CodexProcessAbortedError";
}

export class CodexProcessOutputLimitError extends Error {
  readonly name = "CodexProcessOutputLimitError";
}

export class BunCodexProcessRunner implements CodexProcessRunner {
  async run(request: CodexProcessRequest): Promise<CodexProcessResult> {
    if (request.signal?.aborted) throw new CodexProcessAbortedError("CODEX_PROCESS_ABORTED");
    const remainingMs = request.deadlineAt.getTime() - Date.now();
    if (remainingMs <= 0) throw new CodexProcessTimedOutError("CODEX_PROCESS_DEADLINE_EXCEEDED");

    const process = Bun.spawn([...request.command], {
      cwd: request.cwd,
      env: { ...request.env },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    let timedOut = false;
    let aborted = false;
    const stop = () => process.kill();
    const onAbort = () => {
      aborted = true;
      stop();
    };
    request.signal?.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      stop();
    }, remainingMs);

    try {
      process.stdin.write(request.stdin);
      process.stdin.end();
      const [exitCode, stdout, stderr] = await Promise.all([
        process.exited,
        readBoundedText(process.stdout, request.maxOutputBytes, stop),
        readBoundedText(process.stderr, request.maxOutputBytes, stop),
      ]);
      if (aborted) throw new CodexProcessAbortedError("CODEX_PROCESS_ABORTED");
      if (timedOut) throw new CodexProcessTimedOutError("CODEX_PROCESS_DEADLINE_EXCEEDED");
      return { exitCode, stdout, stderr };
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener("abort", onAbort);
    }
  }
}

async function readBoundedText(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
  stop: () => void,
): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      total += item.value.byteLength;
      if (total > maxBytes) {
        stop();
        throw new CodexProcessOutputLimitError("CODEX_PROCESS_OUTPUT_LIMIT_EXCEEDED");
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export function isolatedCodexEnvironment(codexHome: string): Readonly<Record<string, string>> {
  const env: Record<string, string> = {
    CODEX_HOME: codexHome,
    HOME: codexHome,
    LANG: process.env.LANG ?? "C.UTF-8",
    NO_COLOR: "1",
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    TERM: "dumb",
  };
  if (process.env.LC_ALL) env.LC_ALL = process.env.LC_ALL;
  if (process.env.SSL_CERT_FILE) env.SSL_CERT_FILE = process.env.SSL_CERT_FILE;
  if (process.env.SSL_CERT_DIR) env.SSL_CERT_DIR = process.env.SSL_CERT_DIR;
  if (process.env.HTTP_PROXY) env.HTTP_PROXY = process.env.HTTP_PROXY;
  if (process.env.HTTPS_PROXY) env.HTTPS_PROXY = process.env.HTTPS_PROXY;
  if (process.env.NO_PROXY) env.NO_PROXY = process.env.NO_PROXY;
  return env;
}
