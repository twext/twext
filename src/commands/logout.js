import { clearCredentials } from "../hub.js";

export function logoutCommand(product, log) {
  clearCredentials();
  log.success("Logged out");
  return true;
}
