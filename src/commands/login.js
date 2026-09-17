import {
  HubError,
  NAMESPACE_PATTERN,
  loadCredentials,
  login,
  resolveHubUrl,
  saveCredentials,
} from "../hub.js";
import { ask } from "../prompt.js";

export async function loginCommand(product, { url, namespace, password }, log) {
  const hub = resolveHubUrl(url);
  namespace ??= loadCredentials().namespace;
  if (!namespace) namespace = await ask("Namespace: ");
  if (!NAMESPACE_PATTERN.test(namespace)) {
    log.error("Namespace must be lower-case letters, digits and hyphens (a-z, 0-9, -).");
    return false;
  }
  if (!password) password = await ask("Password: ", true);

  let response;
  try {
    response = await login(hub, namespace, password);
  } catch (err) {
    log.error(err.message);
    if (err instanceof HubError && err.status === 401) {
      log.info("No account yet? Run twext signup to create one.");
    }
    return false;
  }

  saveCredentials({ hub, namespace, token: response.token });
  log.success(`Logged in as ${namespace}`);
  if (response.user.role === "admin")
    log.info("This account is an admin and can review pending versions.");
  return true;
}
