import { readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { create as createTar } from "tar";
import { validateProject } from "../validate.js";
import {
  HubError,
  acceptTerms,
  publishTarball,
  resolveHubUrl,
  resolveNamespace,
  resolveToken,
} from "../hub.js";

// Files that never belong in a published tarball: build output and dependency
// trees the hub neither wants nor needs.
const EXCLUDED = new Set(["dist", "node_modules"]);

function walk(dir, root, files) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED.has(entry.name)) continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, root, files);
    else files.push(relative(root, abs));
  }
  return files;
}

// Packs the project directory (twext.yml's directory) into a gzipped tarball,
// skipping dist/ and node_modules/. Entry paths stay portable so the hub can
// extract them anywhere.
export function packProject(root) {
  const files = walk(resolve(root), resolve(root), []);
  if (!files.includes("twext.yml")) {
    throw new Error("The project directory has no twext.yml; nothing to publish.");
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    const stream = createTar({ gzip: true, portable: true, cwd: root }, files);
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

export async function publishCommand(product, configPath, { url, token }, log) {
  const result = await validateProject(configPath);
  if (!result.ok) {
    for (const message of result.errors) log.error(message);
    return false;
  }
  for (const message of result.warnings) log.warn(message);

  const { config, root } = result.project;

  let tarball;
  try {
    tarball = await packProject(root);
  } catch (err) {
    log.error(err.message);
    return false;
  }

  const hub = resolveHubUrl(url);
  const namespace = resolveNamespace(undefined, hub);
  const authToken = resolveToken(token, hub);
  const explicitToken = token ?? process.env.TWEXTHUB_TOKEN;
  if (!namespace) {
    log.error("Not logged in. Run twext login first.");
    return false;
  }
  if (!authToken) {
    log.error("No token. Run twext login, or pass --token / set TWEXTHUB_TOKEN.");
    return false;
  }

  const id = config.extension.id;
  log.progress(`Publishing ${id}@${config.version} to @${namespace}...`);

  const publish = () => publishTarball(hub, authToken, namespace, id, tarball);
  let version;
  try {
    version = await publish();
  } catch (err) {
    if (!(err instanceof HubError && err.status === 403 && /terms/i.test(err.message))) {
      log.error(err.message);
      return false;
    }
    if (explicitToken) {
      log.error(
        `${err.message} Accept the terms with a session (twext login) before publishing again.`,
      );
      return false;
    }
    log.progress("Accepting the current Terms of Service...");
    try {
      await acceptTerms(hub, authToken);
      version = await publish();
    } catch (acceptErr) {
      log.error(acceptErr.message);
      return false;
    }
  }

  if (version.status === "pending") {
    log.success(`${id}@${config.version} submitted for review (status: pending).`);
    log.info("An admin must approve it before it appears in the registry.");
  } else {
    log.success(`Published ${id}@${config.version}`);
    if (version.dist?.downloadUrl) log.bullet(version.dist.downloadUrl);
  }

  // The hub compiled the uploaded source; its build log may carry warnings the
  // local build did not surface.
  if (version.buildLog) {
    for (const line of version.buildLog.split("\n")) {
      if (/warn/i.test(line)) log.warn(line.trim());
    }
  }
  return true;
}
