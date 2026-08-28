import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import * as ts from "typescript";

export interface ArchitectureVerificationOptions {
  readonly root?: string;
  readonly sourceRoots?: readonly string[];
}

type ImportedModule = Readonly<{
  readonly specifier: string;
  readonly node: ts.Node;
}>;

type AdapterBoundary = "drizzle" | "schema" | "persistence" | "provider";

/**
 * Parse source files and return architecture violations without terminating
 * the caller. AST inspection deliberately ignores comments and string values
 * that are not module specifiers.
 */
export function verifyArchitecture(options: ArchitectureVerificationOptions = {}): readonly string[] {
  const root = resolve(options.root ?? resolve(import.meta.dir, ".."));
  const sourceRoots = (options.sourceRoots ?? ["packages", "apps"]).map((directory) => resolve(root, directory));
  const files = sourceRoots.filter(existsSync).flatMap(walk).filter((file) => supportedSourceFile(file));
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
    const sourceFile = parseSource(file, source);
    const imports = importedModuleSpecifiers(sourceFile);
    const repoPath = relative(root, file).replaceAll("\\", "/");
    if (repoPath.startsWith("packages/domain/")) {
      for (const forbidden of forbiddenDomainImports) {
        if (imports.some(({ specifier }) => specifier === forbidden || specifier.startsWith(`${forbidden}/`))) {
          failures.push(`${repoPath}: domain imports forbidden dependency ${forbidden}`);
        }
      }
    }
    if (
      repoPath.startsWith("packages/application/") &&
      imports.some(({ specifier }) => isInfrastructureSpecifier(specifier, file, root) || specifier === "drizzle-orm")
    ) {
      failures.push(`${repoPath}: application imports infrastructure`);
    }
    if (
      repoPath.startsWith("packages/interface/") &&
      imports.some(({ specifier }) => isSdkDatabaseOrProvider(specifier))
    ) {
      failures.push(`${repoPath}: interface imports a database/provider SDK directly`);
    }
    if (isInboundAdapterPath(repoPath)) {
      for (const { specifier } of imports) {
        const boundary = classifyAdapterBoundary(specifier, file, root);
        if (boundary === "drizzle") {
          failures.push(`${repoPath}: MCP/interface adapter imports Drizzle directly (${specifier})`);
        } else if (boundary === "schema") {
          failures.push(`${repoPath}: MCP/interface adapter imports database schema directly (${specifier})`);
        } else if (boundary === "persistence") {
          failures.push(`${repoPath}: MCP/interface adapter imports database persistence directly (${specifier})`);
        } else if (boundary === "provider") {
          failures.push(`${repoPath}: MCP/interface adapter imports provider adapter directly (${specifier})`);
        }
      }
    }
    if (!prospectMemoryPersistenceReaders.some((allowed) => repoPath.startsWith(allowed))) {
      for (const imported of importedSchemaSymbols(sourceFile, root, file)) {
        if (prospectMemoryPersistenceSymbols.has(imported)) {
          failures.push(`${repoPath}: reads Prospect 360 persistence directly instead of using the application ports`);
        }
      }
      if (hasProspectMemoryQuery(sourceFile)) {
        failures.push(`${repoPath}: queries Prospect 360 persistence directly instead of using the application ports`);
      }
    }
    if (mutatesProspectDecisions(sourceFile) && !imports.some(({ specifier }) => specifier.includes("capture-prospect-decision-mutation"))) {
      failures.push(`${repoPath}: mutates prospectDecisions without a transactional Prospect 360 event`);
    }
  }
  return failures;
}

const root = resolve(import.meta.dir, "..");
if (import.meta.main) {
  const failures = verifyArchitecture({ root });
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  const files = ["packages", "apps"]
    .map((directory) => join(root, directory))
    .filter(existsSync)
    .flatMap(walk)
    .filter((file) => supportedSourceFile(file));
  console.log(`Architecture verified: ${files.length} TypeScript source files.`);
}

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function supportedSourceFile(file: string): boolean {
  return /\.(?:ts|tsx|mts|cts)$/.test(file);
}

function parseSource(file: string, source: string): ts.SourceFile {
  const scriptKind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind);
}

function importedModuleSpecifiers(sourceFile: ts.SourceFile): readonly ImportedModule[] {
  const values: ImportedModule[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      values.push({ specifier: node.moduleSpecifier.text, node });
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      values.push({ specifier: node.moduleReference.expression.text, node });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      values.push({ specifier: node.moduleSpecifier.text, node });
    } else if (ts.isCallExpression(node) && node.arguments.length === 1) {
      const argument = node.arguments[0];
      const dynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const requireCall = ts.isIdentifier(node.expression) && node.expression.text === "require";
      if ((dynamicImport || requireCall) && argument && ts.isStringLiteral(argument)) {
        values.push({ specifier: argument.text, node });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return values;
}

function importedSchemaSymbols(sourceFile: ts.SourceFile, root: string, file: string): readonly string[] {
  const symbols: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const resolved = resolveModuleSpecifier(node.moduleSpecifier.text, file, root);
      if (!isSchemaPath(node.moduleSpecifier.text, resolved)) {
        ts.forEachChild(node, visit);
        return;
      }
      const named = node.importClause?.namedBindings;
      if (named && ts.isNamedImports(named)) {
        for (const element of named.elements) symbols.push(element.name.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return symbols;
}

function hasProspectMemoryQuery(sourceFile: ts.SourceFile): boolean {
  let found = false;
  const pattern = /\b(?:from|join|update|into|delete\s+from)\s+prospect_memory_(?:events|snapshots|context_receipts)\b/i;
  const visit = (node: ts.Node): void => {
    if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      if (pattern.test(node.getText(sourceFile))) found = true;
    }
    if (!found) ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function mutatesProspectDecisions(sourceFile: ts.SourceFile): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const expression = node.expression;
      const argument = node.arguments[0];
      if (
        ts.isPropertyAccessExpression(expression) &&
        (expression.name.text === "insert" || expression.name.text === "update") &&
        argument !== undefined &&
        ts.isIdentifier(argument) &&
        argument.text === "prospectDecisions"
      ) found = true;
    }
    if (!found) ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function isInboundAdapterPath(repoPath: string): boolean {
  return repoPath.startsWith("packages/mcp/") || repoPath.startsWith("packages/interface/src/mcp/");
}

function classifyAdapterBoundary(specifier: string, file: string, root: string): AdapterBoundary | null {
  if (isSdkDatabaseOrProvider(specifier)) return specifier === "drizzle-orm" ? "drizzle" : "provider";
  const resolved = resolveModuleSpecifier(specifier, file, root);
  if (isSchemaPath(specifier, resolved)) return "schema";
  if (isDatabasePersistencePath(specifier, resolved)) return "persistence";
  if (isInfrastructureSpecifier(specifier, file, root)) {
    return isProviderAdapterPath(specifier, resolved) ? "provider" : "persistence";
  }
  return null;
}

function isSdkDatabaseOrProvider(specifier: string): boolean {
  return specifier === "drizzle-orm"
    || specifier === "postgres"
    || specifier === "openai"
    || specifier === "@langchain/openai"
    || specifier.startsWith("@aws-sdk/client-");
}

function isInfrastructureSpecifier(specifier: string, file: string, root: string): boolean {
  return specifier === "@outbound/infrastructure"
    || specifier.startsWith("@outbound/infrastructure/")
    || resolveModuleSpecifier(specifier, file, root).includes("/packages/infrastructure/src/");
}

function isSchemaPath(specifier: string, resolved: string): boolean {
  const normalized = stripExtension(specifier.replaceAll("\\", "/"));
  const normalizedResolved = stripExtension(resolved.replaceAll("\\", "/"));
  return normalized === "@outbound/infrastructure/database/schema"
    || /(?:^|\/)database\/schema$/.test(normalized)
    || /\/packages\/infrastructure\/src\/database\/schema$/.test(normalizedResolved);
}

function isDatabasePersistencePath(specifier: string, resolved: string): boolean {
  const normalized = specifier.replaceAll("\\", "/");
  const normalizedResolved = resolved.replaceAll("\\", "/");
  return normalized.startsWith("@outbound/infrastructure/database/")
    || /(?:^|\/)infrastructure\/database\//.test(normalized)
    || /\/packages\/infrastructure\/src\/database\//.test(normalizedResolved);
}

function isProviderAdapterPath(specifier: string, resolved: string): boolean {
  return /(?:unipile|calcom|provider|publisher|client|langchain|kimi|codex|crawler|social)/i.test(`${specifier} ${resolved}`);
}

function resolveModuleSpecifier(specifier: string, file: string, root: string): string {
  if (specifier.startsWith("@outbound/infrastructure/")) {
    return resolve(root, "packages/infrastructure/src", specifier.slice("@outbound/infrastructure/".length));
  }
  if (specifier === "@outbound/infrastructure") return resolve(root, "packages/infrastructure/src");
  if (specifier.startsWith(".")) return resolve(dirname(file), specifier);
  return specifier;
}

function stripExtension(value: string): string {
  return value.replace(/\.(?:[cm]?[jt]sx?)$/, "");
}
