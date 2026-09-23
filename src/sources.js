import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

function toPosix(path) {
  return path.split(sep).join("/");
}

// Collects the project's text files for upload: what the hub compiles and
// what an admin reviews. Build output, vendored dependencies, hidden files
// (.git, .env), package.json files (the hub writes its own into the build
// directory and rejects them in uploads), and symlinks stay out.
export function collectSources(root, { manifestPath, outputPath }) {
  const sources = {};
  const absRoot = resolve(root);
  const absManifest = resolve(manifestPath);
  const absOutput = outputPath ? resolve(join(absRoot, outputPath)) : null;

  function visit(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      if (entry.name.startsWith(".")) continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        visit(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (abs === absManifest || abs === absOutput) continue;
      if (entry.name === "package.json") continue;
      const buffer = readFileSync(abs);
      const text = buffer.toString("utf8");
      if (Buffer.compare(buffer, Buffer.from(text, "utf8")) !== 0) continue;
      sources[toPosix(relative(absRoot, abs))] = text;
    }
  }

  visit(absRoot);
  return sources;
}
