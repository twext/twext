import {
  HubError,
  NAMESPACE_PATTERN,
  loadCredentials,
  login,
  resolveHubUrl,
  saveCredentials,
  signup,
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

  let token;
  let role;
  let created = false;
  try {
    try {
      const response = await login(hub, namespace, password);
      token = response.token;
      role = response.user.role;
    } catch (err) {
      if (err instanceof HubError && err.status === 401) {
        const response = await signup(hub, namespace, password);
        created = true;
        token = response.token;
        role = response.user.role;
      } else {
        throw err;
      }
    }
  } catch (err) {
    log.error(err.message);
    return false;
  }

  saveCredentials({ hub, namespace, token });
  log.success(created ? `Signed up as ${namespace}` : `Logged in as ${namespace}`);
  if (role === "admin") log.info("This account is an admin and can review pending versions.");
  return true;
}
