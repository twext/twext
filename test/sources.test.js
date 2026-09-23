import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectSources } from "../src/sources.js";

function tmpProject() {
  const dir = mkdtempSync(join(tmpdir(), "twext-sources-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("collectSources includes project text files only", () => {
  const { dir, cleanup } = tmpProject();
  try {
    mkdirSync(join(dir, "src", "blocks"), { recursive: true });
    mkdirSync(join(dir, "node_modules", "dep"), { recursive: true });
    mkdirSync(join(dir, ".git"), { recursive: true });
    mkdirSync(join(dir, "dist"), { recursive: true });
    mkdirSync(join(dir, "src", "components"), { recursive: true });
    writeFileSync(join(dir, "twext.yml"), "entryPoint: src/index.js\n", "utf8");
    writeFileSync(join(dir, "package.json"), '{ "type": "module" }\n', "utf8");
    writeFileSync(join(dir, "src", "index.js"), "export const blocks = {};\n", "utf8");
    writeFileSync(join(dir, "src", "blocks", "hello.js"), "export const hello = 1;\n", "utf8");
    writeFileSync(join(dir, "src", "components", "package.json"), '{ "private": true }\n', "utf8");
    writeFileSync(join(dir, "node_modules", "dep", "index.js"), "secret dep\n", "utf8");
    writeFileSync(join(dir, ".git", "config"), "[core]\n", "utf8");
    writeFileSync(join(dir, ".env"), "TOKEN=shh\n", "utf8");
    writeFileSync(join(dir, "dist", "extension.js"), "built output\n", "utf8");
    writeFileSync(join(dir, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]), "utf8");
    symlinkSync(join(dir, "src", "index.js"), join(dir, "link.js"));

    const sources = collectSources(dir, {
      manifestPath: join(dir, "twext.yml"),
      outputPath: "dist/extension.js",
    });

    assert.deepEqual(Object.keys(sources).sort(), ["src/blocks/hello.js", "src/index.js"]);
    assert.equal(sources["src/index.js"], "export const blocks = {};\n");
    assert.ok(!("twext.yml" in sources), "the manifest travels separately");
    assert.ok(!("package.json" in sources), "package.json is written by the hub");
    assert.ok(!("src/components/package.json" in sources), "nested package.json stays out too");
    assert.ok(!(".env" in sources), "hidden files are excluded");
    assert.ok(!("node_modules/dep/index.js" in sources));
    assert.ok(!("dist/extension.js" in sources), "the build output is excluded");
    assert.ok(!("link.js" in sources), "symlinks are excluded");
    assert.ok(!("logo.png" in sources), "binary files are excluded");
  } finally {
    cleanup();
  }
});
