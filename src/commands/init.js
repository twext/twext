import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

function templateYml(fallbackColor) {
  return `name: "my-extension"
version: "0.1.0"
description: ""
author: ""
license: "MIT"

entryPoint: "src/index.js"
outputPath: "dist/extension.js"

extension:
  id: "myExtension"
  name: "My Extension"
  className: "MyExtension"
  color1: "${fallbackColor}"
  color2: "${fallbackColor}"
  color3: "${fallbackColor}"

blocks:
  - opcode: hello
    blockType: reporter
    text: "say hello"
`;
}

function templateIndex() {
  return `import { hello } from "./blocks/hello.js";

export const blocks = {
  hello,
};

export function setup() {
  console.log("[my-extension] loaded");
}
`;
}

function templateHello() {
  return `export function hello(args, util) {
  return "Hello TurboWarp!";
}
`;
}

const FILES = {
  "twext.yml": (product) => templateYml(product.defaults.fallbackColor ?? "#0070F3"),
  "src/index.js": () => templateIndex(),
  "src/blocks/hello.js": () => templateHello(),
};

export function initCommand(product, target, force, log) {
  const dir = resolve(target ?? ".");
  const conflicts = [];
  for (const rel of Object.keys(FILES)) {
    if (existsSync(join(dir, rel)) && !force) conflicts.push(rel);
  }
  if (conflicts.length > 0) {
    for (const rel of conflicts)
      log.error(`${relative(process.cwd(), resolve(dir, rel))} already exists`);
    log.info(`Use -f to overwrite existing files.`);
    return false;
  }
  mkdirSync(dir, { recursive: true });
  for (const [rel, render] of Object.entries(FILES)) {
    const path = join(dir, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, render(product), "utf8");
    log.bullet(relative(process.cwd(), path));
  }
  log.success(`Initialized ${dir}`);
  return true;
}
