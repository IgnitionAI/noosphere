import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const sourceRoots = ["packages", "apps"].map((directory) => join(root, directory));
const files = sourceRoots.flatMap(walk).filter((file) => file.endsWith(".ts"));
const failures: string[] = [];

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
