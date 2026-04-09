import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC_ROOT = path.join(ROOT, "src");

const WRAPPER_FILES = new Set([
  path.join(SRC_ROOT, "server.js"),
  path.join(SRC_ROOT, "manifest.js"),
  path.join(SRC_ROOT, "anime", "index.js"),
  path.join(SRC_ROOT, "anime", "detection.js"),
  path.join(SRC_ROOT, "providers", "index.js"),
  path.join(SRC_ROOT, "providers", "base.js"),
  path.join(SRC_ROOT, "providers", "webstreambase.js"),
  path.join(SRC_ROOT, "lib", "stream-scoring.js")
]);

function walk(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walk(fullPath));
      continue;
    }

    if (entry.isFile() && fullPath.endsWith(".js")) {
      results.push(fullPath);
    }
  }
  return results;
}

function relative(fullPath) {
  return path.relative(ROOT, fullPath).replace(/\\/g, "/");
}

function extractRelativeImports(content) {
  const matches = [];
  const patterns = [
    /from\s+["']([^"']+)["']/g,
    /export\s+\*\s+from\s+["']([^"']+)["']/g,
    /export\s+\{[^}]*\}\s+from\s+["']([^"']+)["']/g
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier.startsWith(".")) {
        matches.push(specifier);
      }
    }
  }

  return matches;
}

function resolveImportTarget(filePath, specifier) {
  const absolute = path.resolve(path.dirname(filePath), specifier);
  const withExtension = absolute.endsWith(".js") ? absolute : `${absolute}.js`;
  return withExtension;
}

function validateWrappers() {
  for (const wrapperPath of WRAPPER_FILES) {
    assert.ok(fs.existsSync(wrapperPath), `Wrapper esperado no existe: ${relative(wrapperPath)}`);
  }
}

function validateInternalImports() {
  const violations = [];
  const files = walk(SRC_ROOT).filter((fullPath) => !WRAPPER_FILES.has(fullPath));

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, "utf8");
    const imports = extractRelativeImports(content);

    for (const specifier of imports) {
      const targetPath = resolveImportTarget(filePath, specifier);
      if (WRAPPER_FILES.has(targetPath)) {
        violations.push({
          file: relative(filePath),
          specifier,
          target: relative(targetPath)
        });
      }
    }
  }

  assert.equal(
    violations.length,
    0,
    `Imports internos apuntando a wrappers viejos:\n${violations.map((item) => `- ${item.file} -> ${item.specifier} (${item.target})`).join("\n")}`
  );

  return {
    fileCount: files.length
  };
}

function main() {
  validateWrappers();
  const imports = validateInternalImports();

  console.log(JSON.stringify({
    wrappers: WRAPPER_FILES.size,
    imports
  }, null, 2));
}

main();
