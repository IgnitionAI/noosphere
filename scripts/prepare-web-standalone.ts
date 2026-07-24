import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";

const webRoot = join(import.meta.dir, "..", "apps", "web");
const standaloneWebRoot = join(webRoot, ".next", "standalone", "apps", "web");

await mkdir(join(standaloneWebRoot, ".next"), { recursive: true });
await cp(
  join(webRoot, ".next", "static"),
  join(standaloneWebRoot, ".next", "static"),
  { recursive: true, force: true },
);

console.log("Next.js standalone assets are ready.");
