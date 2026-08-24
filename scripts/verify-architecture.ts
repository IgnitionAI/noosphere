import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const sourceRoots = ["packages", "apps"].map((directory) => join(root, directory));
const files = sourceRoots.flatMap(walk).filter((file) => file.endsWith(".ts"));
const failures: string[] = [];
const prospectMemoryPersistenceSymbols = new Set([
  "prospectMemoryEvents",
  "prospectMemorySnapshots",
  "prospectMemoryContextReceipts",
]);
const prospectMemoryPersistenceReaders = [
  "packages/infrastructure/src/prospect-memory/",
  "packages/infrastructure/src/workspaces/postgres-workspace-data-lifecycle.ts",
  "packages/infrastructure/src/workspaces/workspace-data-export.ts",
  "packages/infrastructure/src/database/schema.ts",
];

const forbiddenDomainImports = [
  "next",
  "react",
  "better-auth",
  "drizzle-orm",
  "postgres",
  "zod",
  "@outbound/application",
  "@outbound/infrastructure",
  "@outbound/contracts",
];

for (const file of files) {
  const source = readFileSync(file, "utf8");
  const repoPath = relative(root, file);
  if (repoPath.startsWith("packages/domain/")) {
    for (const forbidden of forbiddenDomainImports) {
      if (source.includes(`from "${forbidden}`) || source.includes(`from '${forbidden}`)) {
        failures.push(`${repoPath}: domain imports forbidden dependency ${forbidden}`);
      }
    }
  }
  if (
    repoPath.startsWith("packages/application/") &&
    (source.includes('@outbound/infrastructure') || source.includes('from "drizzle-orm'))
  ) {
    failures.push(`${repoPath}: application imports infrastructure`);
  }
  if (repoPath.startsWith("packages/interface/") && source.includes("drizzle-orm")) {
    failures.push(`${repoPath}: interface imports Drizzle`);
  }
  if (!prospectMemoryPersistenceReaders.some((allowed) => repoPath.startsWith(allowed))) {
    for (const imported of importedSchemaSymbols(source)) {
      if (prospectMemoryPersistenceSymbols.has(imported)) {
        failures.push(`${repoPath}: reads Prospect 360 persistence directly instead of using the application ports`);
      }
    }
    if (/\b(?:from|join|update|into|delete\s+from)\s+prospect_memory_(?:events|snapshots|context_receipts)\b/i.test(source)) {
      failures.push(`${repoPath}: queries Prospect 360 persistence directly instead of using the application ports`);
    }
  }
  if (
    /\.(?:insert|update)\(prospectDecisions\)/.test(source)
    && !source.includes("captureProspectDecisionMutation")
  ) {
    failures.push(`${repoPath}: mutates prospectDecisions without a transactional Prospect 360 event`);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`Architecture verified: ${files.length} TypeScript source files.`);

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function importedSchemaSymbols(source: string): readonly string[] {
  const symbols: string[] = [];
  const pattern = /import\s*\{([\s\S]*?)\}\s*from\s*["']@outbound\/infrastructure\/database\/schema["']/g;
  for (const match of source.matchAll(pattern)) {
    for (const value of (match[1] ?? "").split(",")) {
      const name = value.trim().split(/\s+as\s+/)[0]?.trim();
      if (name) symbols.push(name);
    }
  }
  return symbols;
}
