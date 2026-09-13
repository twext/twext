import { BLOCK_TYPES, ARGUMENT_TYPES } from "./compile.js";
import { loadProject } from "./project.js";

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

export async function validateProject(configPath) {
  const errors = [];
  const warnings = [];
  let project;
  try {
    project = await loadProject(configPath);
  } catch (err) {
    return { ok: false, errors: [err.message], warnings: [], project: null };
  }

  const { config, module: mod } = project;

  if (!config.extension || typeof config.extension !== "object") {
    errors.push('twext.yml must define an "extension" section');
  } else {
    const ext = config.extension;
    if (!ext.id) errors.push("extension.id is required");
    if (!ext.name) warnings.push("extension.name is missing; falling back to the project name");
    if (ext.className && !IDENTIFIER.test(ext.className)) {
      errors.push(`extension.className "${ext.className}" is not a valid identifier`);
    } else if (!ext.className) {
      warnings.push("extension.className is missing; deriving it from the id");
    }
  }

  if (!Array.isArray(config.blocks) || config.blocks.length === 0) {
    errors.push('twext.yml must define at least one entry in "blocks"');
  } else {
    const declared = new Set();
    for (const block of config.blocks) {
      const isLabel = block.blockType === "label";
      if (!isLabel) {
        if (typeof block.opcode !== "string" || !block.opcode) {
          errors.push("A blocks entry is missing an opcode");
          continue;
        }
        if (declared.has(block.opcode)) {
          errors.push(`Duplicate opcode "${block.opcode}" in blocks`);
        }
        declared.add(block.opcode);
        if (typeof mod.blocks[block.opcode] !== "function") {
          errors.push(
            `Block "${block.opcode}" has no handler function exported in the "blocks" map`,
          );
        }
      }
      const name = block.opcode ?? block.text ?? "(unnamed block)";
      if (block.blockType && !(block.blockType in BLOCK_TYPES)) {
        errors.push(`Block "${name}" uses unknown blockType "${block.blockType}"`);
      }
      if (block.text && typeof block.text !== "string") {
        errors.push(`Block "${name}" text must be a string`);
      }
      if (block.arguments && typeof block.arguments === "object") {
        for (const [argumentName, argument] of Object.entries(block.arguments)) {
          if (!argument || typeof argument !== "object") {
            errors.push(`Block "${name}" argument "${argumentName}" must be a mapping`);
            continue;
          }
          if (argument.type && !(argument.type in ARGUMENT_TYPES)) {
            errors.push(
              `Block "${name}" argument "${argumentName}" uses unknown type "${argument.type}"`,
            );
          }
        }
      }
    }
    for (const [opcode, handler] of Object.entries(mod.blocks)) {
      if (typeof handler === "function" && !declared.has(opcode)) {
        warnings.push(`Handler "${opcode}" is exported but not declared in twext.yml`);
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings, project };
}
