import { clearCredentials, logout, resolveHubUrl, resolveToken } from "../hub.js";

// Forgets the stored credentials and, when a session token is available,
// revokes the session on the hub first.
export async function logoutCommand(product, { url, token }, log) {
  let revoked = false;
  if (token === undefined && process.env.TWEXTHUB_TOKEN === undefined) {
    try {
      const hub = resolveHubUrl(url);
      const authToken = resolveToken(undefined, hub);
      if (authToken) {
        await logout(hub, authToken);
        revoked = true;
      }
    } catch (err) {
      log.warn(`Could not revoke the session on the hub: ${err.message}`);
    }
  }
  clearCredentials();
  log.success(revoked ? "Logged out and revoked the session" : "Logged out");
  return true;
}
