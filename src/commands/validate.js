import { validateProject } from "../validate.js";

export async function validateCommand(product, configPath, log) {
  const result = await validateProject(configPath);
  if (!result.ok) {
    for (const message of result.errors) log.error(message);
    return false;
  }
  for (const message of result.warnings) log.warn(message);
  const count = result.project.config.blocks.length;
  log.info(`${product.symbols.success} ${count} block${count === 1 ? "" : "s"} validated`);
  return true;
}
