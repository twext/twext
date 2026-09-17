import { compileExtension } from "../compile.js";
import { validateProject } from "../validate.js";
import {
  HubError,
  acceptTerms,
  publishVersion,
  resolveHubUrl,
  resolveNamespace,
  resolveToken,
} from "../hub.js";

function manifestOf(config) {
  const id = config.extension.id;
  const manifest = {
    id,
    name: config.extension.name ?? config.name ?? id,
    version: String(config.version),
    license: String(config.license ?? "MIT"),
    description: String(config.description ?? ""),
  };
  if (typeof config.author === "string" && config.author) manifest.author = config.author;
  for (const color of ["color1", "color2", "color3"]) {
    if (typeof config.extension[color] === "string" && config.extension[color]) {
      manifest[color] = config.extension[color];
    }
  }
  return manifest;
}

export async function publishCommand(product, configPath, { url, token }, log) {
  const result = await validateProject(configPath);
  if (!result.ok) {
    for (const message of result.errors) log.error(message);
    return false;
  }
  for (const message of result.warnings) log.warn(message);

  const { config } = result.project;
  const manifest = manifestOf(config);
  const code = compileExtension(result.project, product);

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

  log.progress(`Publishing ${manifest.id}@${manifest.version} to @${namespace}...`);

  const publish = () => publishVersion(hub, authToken, namespace, manifest.id, manifest, code);
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
    log.success(`${manifest.id}@${manifest.version} submitted for review (status: pending).`);
    log.info("An admin must approve it before it appears in the registry.");
  } else {
    log.success(`Published ${manifest.id}@${manifest.version}`);
    if (version.dist?.downloadUrl) log.bullet(version.dist.downloadUrl);
  }
  return true;
}
