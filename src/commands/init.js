import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
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

function parentDirs(dir, rel) {
  const out = [];
  let parent = dirname(join(dir, rel));
  while (parent !== dir) {
    out.push(parent);
    parent = dirname(parent);
  }
  return out;
}

export function initCommand(product, target, force, log) {
  const dir = resolve(target ?? ".");
  let existing = dir;
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  if (!statSync(existing).isDirectory()) {
    log.error(`${relative(process.cwd(), existing)} exists and is not a directory`);
    return false;
  }
  const conflicts = [];
  for (const rel of Object.keys(FILES)) {
    if (existsSync(join(dir, rel)) && !force) conflicts.push(rel);
  }
  const blockedParents = new Set();
  for (const rel of Object.keys(FILES)) {
    for (const parent of parentDirs(dir, rel)) {
      if (existsSync(parent) && !statSync(parent).isDirectory()) blockedParents.add(parent);
    }
  }
  if (conflicts.length > 0 || blockedParents.size > 0) {
    for (const rel of conflicts)
      log.error(`${relative(process.cwd(), resolve(dir, rel))} already exists`);
    for (const parent of blockedParents)
      log.error(`${relative(process.cwd(), parent)} exists and is not a directory`);
    if (conflicts.length > 0) log.info(`Use -f to overwrite existing files.`);
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
