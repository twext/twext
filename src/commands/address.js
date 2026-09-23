import { EXTENSION_ID_PATTERN } from "../validate.js";

export const NAMESPACE_PATTERN = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$|^[a-z0-9]$/;

// Parses "@namespace/id" or "@namespace/id@version" (the leading @ is
// optional). Returns { namespace, id, version } or null after logging.
export function parseRegistryAddress(raw, log, { requireVersion = false } = {}) {
  const text = typeof raw === "string" ? raw.trim() : "";
  const match = /^@?([a-z0-9][a-z0-9-]*)\/([a-z0-9]{1,64})(?:@([^@\s]+))?$/.exec(text);
  if (!match) {
    log.error(
      requireVersion
        ? 'Expected an "@namespace/id@version" address.'
        : 'Expected an "@namespace/id" address (optionally "@namespace/id@version").',
    );
    return null;
  }
  const [, namespace, id, version] = match;
  if (!NAMESPACE_PATTERN.test(namespace)) {
    log.error(`"${namespace}" is not a valid namespace.`);
    return null;
  }
  if (!EXTENSION_ID_PATTERN.test(id)) {
    log.error(`"${id}" is not a valid extension id.`);
    return null;
  }
  if (requireVersion && !version) {
    log.error('No version given; use "@namespace/id@version".');
    return null;
  }
  return { namespace, id, version: version ?? null };
}
