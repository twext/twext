import { dirname, resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { compileExtension } from "../compile.js";
import { validateProject } from "../validate.js";

export async function buildCommand(product, configPath, outOverride, log) {
  const result = await validateProject(configPath);
  if (!result.ok) {
    for (const message of result.errors) log.error(message);
    return false;
  }
  for (const message of result.warnings) log.warn(message);

  const { config, root, module: mod } = result.project;
  const output =
    outOverride ??
    (config.outputPath
      ? resolve(root, config.outputPath)
      : resolve(root, product.defaults.outputDirectory, "extension.js"));

  log.progress(`Building ${config.extension?.name ?? config.name ?? "extension"}...`);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, compileExtension({ config, root, module: mod }, product), "utf8");
  log.success(`Built ${output}`);
  return true;
}
