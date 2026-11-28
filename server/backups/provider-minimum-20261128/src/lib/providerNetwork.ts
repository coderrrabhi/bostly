/**
 * Network failures that happen before a TCP/TLS connection to the provider
 * exists. The paid "add" request body can never have reached the provider,
 * so the run is safe to send to the next-priority provider. Anything else
 * (timeouts after connect, resets, unreadable replies) stays "uncertain".
 */
const NEVER_CONNECTED = new Set([
  "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT", "ERR_TLS_CERT_ALTNAME_INVALID", "CERT_HAS_EXPIRED",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN",
]);

export function requestNeverReachedProvider(error: unknown): boolean {
  let cur: any = error;
  for (let i = 0; cur && i < 5; i += 1) {
    if (typeof cur.code === "string" && NEVER_CONNECTED.has(cur.code)) return true;
    cur = cur.cause;
  }
  return false;
}
