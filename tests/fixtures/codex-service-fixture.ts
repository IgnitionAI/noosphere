#!/usr/bin/env bun
// Controlled executable for isolated login/probe browser tests. Never used in production.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const home = process.env.CODEX_HOME;
if (!home || home !== process.env.HOME || process.env.OPENAI_API_KEY || process.env.DATABASE_URL) process.exit(3);
const authPath = join(home, "auth.json");
if (process.argv.includes("login")) {
  if (!process.argv.includes("--device-auth")) process.exit(4);
  writeFileSync(authPath, JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: "browser-fixture-access", refresh_token: "browser-fixture-refresh" } }), { mode: 0o600 });
} else {
  let auth;
  try { auth = JSON.parse(readFileSync(authPath, "utf8")); } catch { console.error("not logged in"); process.exit(1); }
  if (auth.expired) { console.error("authentication expired"); process.exit(1); }
  for (const flag of ["features.shell_tool=false", "features.plugins=false", "project_doc_max_bytes=0"]) {
    if (!process.argv.includes(flag)) process.exit(5);
  }
  const output = process.argv[process.argv.indexOf("--output-last-message") + 1];
  if (!output) process.exit(6);
  writeFileSync(output, JSON.stringify({ ok: true }));
}
