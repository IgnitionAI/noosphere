import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const prototype = join(root, "prototype");

const requiredScreens = [
  "dashboard.html",
  "approvals.html",
  "prospects.html",
  "discover.html",
  "prospect-detail.html",
  "companies.html",
  "company-detail.html",
  "product-reading.html",
  "research-progress.html",
  "icp-builder.html",
  "offers.html",
  "icps.html",
  "campaigns.html",
  "campaign-builder.html",
  "campaign-detail.html",
  "sequences.html",
  "inbox.html",
  "pipeline.html",
  "knowledge.html",
  "ai-studio.html",
  "analytics.html",
  "integrations.html",
  "settings.html",
  "components.html",
  "login.html",
  "onboarding.html"
];

const failures: string[] = [];
for (const screen of requiredScreens) {
  if (!existsSync(join(prototype, screen))) failures.push(`missing screen: ${screen}`);
}

const files = [
  ...readdirSync(prototype)
    .filter((file) => file.endsWith(".html"))
    .map((file) => join(prototype, file)),
  ...readdirSync(join(prototype, "assets"))
    .filter((file) => file.endsWith(".js"))
    .map((file) => join(prototype, "assets", file))
];

const referencePattern = /(?:href|src)=["']([^"'#]+)["']/g;
for (const file of files) {
  const content = readFileSync(file, "utf8");
  for (const match of content.matchAll(referencePattern)) {
    const reference = match[1];
    if (!reference) continue;
    if (/^(https?:|mailto:|tel:)/.test(reference) || reference.includes("${")) continue;
    const base = dirname(file) === join(prototype, "assets") ? prototype : dirname(file);
    const target = join(base, reference);
    if (!existsSync(target)) failures.push(`${file}: missing local reference ${reference}`);
  }
}

const appSource = readFileSync(join(prototype, "assets", "app.js"), "utf8");
for (const screen of requiredScreens) {
  const page = screen.replace(".html", "");
  if (!appSource.includes(`${page}:`) && !appSource.includes(`"${page}":`)) {
    failures.push(`router does not declare page: ${page}`);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`Prototype verified: ${requiredScreens.length} required screens, ${files.length} source files.`);
