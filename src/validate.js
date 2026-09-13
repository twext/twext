import { BLOCK_TYPES, ARGUMENT_TYPES, resolveSetup } from "./compile.js";
import { loadProject } from "./project.js";
import {
  RUNTIME_GLOBALS,
  handlerFreeVariables,
  programFreeVariables,
  topLevelDeclarations,
} from "./free-vars.js";

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

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
      if (!block || typeof block !== "object" || Array.isArray(block)) {
        errors.push("Each blocks entry must be a mapping");
        continue;
      }
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
      if (block.blockType && !hasOwn(BLOCK_TYPES, block.blockType)) {
        errors.push(`Block "${name}" uses unknown blockType "${block.blockType}"`);
      }
      if (block.text && typeof block.text !== "string") {
        errors.push(`Block "${name}" text must be a string`);
      }
      if (block.arguments !== undefined) {
        if (
          block.arguments === null ||
          typeof block.arguments !== "object" ||
          Array.isArray(block.arguments)
        ) {
          errors.push(`Block "${name}" arguments must be a mapping`);
        } else {
          for (const [argumentName, argument] of Object.entries(block.arguments)) {
            if (!argument || typeof argument !== "object" || Array.isArray(argument)) {
              errors.push(`Block "${name}" argument "${argumentName}" must be a mapping`);
              continue;
            }
            if (argument.type && !hasOwn(ARGUMENT_TYPES, argument.type)) {
              errors.push(
                `Block "${name}" argument "${argumentName}" uses unknown type "${argument.type}"`,
              );
            }
          }
        }
      }
    }
    for (const [opcode, handler] of Object.entries(mod.blocks)) {
      if (typeof handler === "function" && !declared.has(opcode)) {
        warnings.push(`Handler "${opcode}" is exported but not declared in twext.yml`);
      }
    }
    validateReferences(errors, project);
  }

  return { ok: errors.length === 0, errors, warnings, project };
}

function validateReferences(errors, { config, module: mod }) {
  let setupText = "";
  try {
    setupText = resolveSetup(mod.setup);
  } catch (err) {
    errors.push(`setup is not a string, function, or array: ${err.message}`);
  }
  const available = new Set(RUNTIME_GLOBALS);
  if (setupText.trim()) {
    try {
      for (const name of topLevelDeclarations(setupText)) available.add(name);
      const missing = [...programFreeVariables(setupText)].filter((name) => !available.has(name));
      if (missing.length > 0) {
        errors.push(
          `setup references ${missing
            .map((name) => `"${name}"`)
            .join(", ")}, which is not defined in the compiled extension`,
        );
      }
    } catch (err) {
      errors.push(`setup could not be analyzed: ${err.message}`);
    }
  }

  for (const block of config.blocks) {
    if (!block || typeof block !== "object" || Array.isArray(block)) continue;
    const handler = mod.blocks[block.opcode];
    if (block.blockType === "label" || typeof handler !== "function") continue;
    let missing;
    try {
      missing = [...handlerFreeVariables(handler.toString())].filter(
        (name) => !available.has(name),
      );
    } catch (err) {
      errors.push(`Handler "${block.opcode}" could not be analyzed: ${err.message}`);
      continue;
    }
    if (missing.length > 0) {
      errors.push(
        `Handler "${block.opcode}" references ${missing
          .map((name) => `"${name}"`)
          .join(
            ", ",
          )}, which is not defined in the compiled extension; put shared state in "setup" or inline it`,
      );
    }
  }
}
