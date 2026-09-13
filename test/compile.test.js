import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import vm from "node:vm";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { loadProduct } from "../src/config.js";
import { loadProject } from "../src/project.js";
import { compileExtension } from "../src/compile.js";
import { validateProject } from "../src/validate.js";

const fixture = (name) => fileURLToPath(new URL(`../test-fixtures/${name}`, import.meta.url));

function executeExtension(code) {
  global.Scratch = {
    BlockType: { COMMAND: "command", REPORTER: "reporter", BOOLEAN: "boolean", LABEL: "label" },
    ArgumentType: { STRING: "string", NUMBER: "number", BOOLEAN: "boolean" },
    extensions: {
      register(ext) {
        global.__registered = ext;
      },
    },
  };
  vm.runInThisContext(code, { filename: "extension.js" });
  return global.__registered;
}

test("compiles the basic fixture into the expected IIFE shape", async () => {
  const product = loadProduct();
  const configPath = join(fixture("basic"), "twext.yml");
  const project = await loadProject(configPath);
  const code = compileExtension(project, product);

  assert.match(code, /^\(function \(Scratch\) \{\n/);
  assert.match(code, /\}\)\(Scratch\);\n$/);
  assert.match(code, /"use strict";/);
  assert.match(code, /const prefix = "\[Super Utilities\]:";/);
  assert.match(code, /class SuperUtilitiesExtension \{/);
  assert.match(code, /Scratch\.extensions\.register\(new SuperUtilitiesExtension\(\)\);/);

  assert.match(code, /opcode: "logMessage",/);
  assert.match(code, /blockType: Scratch\.BlockType\.COMMAND,/);
  assert.match(code, /text: "log \[MESSAGE\] to console",/);
  assert.match(code, /type: Scratch\.ArgumentType\.STRING,/);
  assert.match(code, /defaultValue: "Hello TurboWarp!",/);
  assert.match(code, /defaultValue: 4,/);

  assert.match(code, /logMessage\(args, util\) \{/);
  assert.match(code, /console\.log\(prefix, args\.MESSAGE\);/);
  assert.match(code, /square\(\{ VALUE \}\)/);
  assert.match(code, /const loud = \(text\) => `\$\{text\}!`;/);

  assert.match(code, /blockType: Scratch\.BlockType\.LABEL,/);
  assert.match(code, /text: "Custom Utilities",/);
  assert.doesNotMatch(code, /opcode: (null|undefined),/);
});

test("compiled extension runs and behaves like a real extension", async () => {
  const product = loadProduct();
  const project = await loadProject(join(fixture("basic"), "twext.yml"));
  const code = compileExtension(project, product);

  const extension = executeExtension(code);
  const info = extension.getInfo();
  assert.equal(info.id, "superUtilities");
  assert.equal(info.name, "Super Utilities");
  assert.equal(info.color1, "#FF4D4D");
  assert.equal(info.blocks.length, 4);
  assert.equal(info.blocks[0].opcode, "logMessage");
  assert.equal(info.blocks[0].blockType, "command");
  assert.equal(info.blocks[0].arguments.MESSAGE.type, "string");
  assert.equal(info.blocks[0].arguments.MESSAGE.defaultValue, "Hello TurboWarp!");
  assert.equal(info.blocks[1].arguments.VALUE.type, "number");
  assert.equal(info.blocks[3].blockType, "label");
  assert.equal(info.blocks[3].opcode, undefined);
  assert.equal(info.blocks[3].text, "Custom Utilities");

  assert.equal(extension.square({ VALUE: 5 }), 25);
  assert.equal(extension.shout({ THING: "wow" }), "wow!");
  extension.logMessage({ MESSAGE: "hi" });
});

test("getInfo injects null; omitted topics", async () => {
  const product = loadProduct();
  const project = await loadProject(join(fixture("basic"), "twext.yml"));
  const code = compileExtension(project, product);
  assert.doesNotMatch(code, /undefined/);
});

test("omits color2 and color3 when only color1 is set", async () => {
  const dir = mkdtempSync(join(tmpdir(), "twext-color-"));
  try {
    mkdirSync(join(dir, "src"));
    writeFileSync(
      join(dir, "twext.yml"),
      `entryPoint: "src/index.js"
outputPath: "dist/extension.js"
extension:
  id: colorDemo
  name: "Color Demo"
  color1: "#FF0000"
blocks:
  - opcode: ping
    blockType: reporter
    text: "ping"
`,
      "utf8",
    );
    writeFileSync(
      join(dir, "src", "index.js"),
      'export const blocks = { ping() { return "pong"; } };\n',
      "utf8",
    );

    const project = await loadProject(join(dir, "twext.yml"));
    const code = compileExtension(project, loadProduct());
    assert.doesNotMatch(code, /color2|color3/);
    const info = executeExtension(code).getInfo();
    assert.equal(info.color1, "#FF0000");
    assert.equal(info.color2, undefined);
    assert.equal(info.color3, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("validate accepts the basic fixture", async () => {
  const result = await validateProject(join(fixture("basic"), "twext.yml"));
  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 0);
});

test("validate rejects missing handlers and unknown types", async () => {
  const result = await validateProject(join(fixture("broken"), "twext.yml"));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('Block "nope"')));
  assert.ok(result.errors.some((e) => e.includes('unknown blockType "imagetype"')));
  assert.ok(result.errors.some((e) => e.includes('unknown type "imaginary"')));
});

test("compile throws on an unknown blockType", async () => {
  const product = loadProduct();
  const project = await loadProject(join(fixture("broken"), "twext.yml"));
  assert.throws(() => compileExtension(project, product), /Unknown blockType "imagetype"/);
});
