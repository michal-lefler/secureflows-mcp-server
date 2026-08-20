import { SecureFlowsHttpError, isSessionSignedOutError } from "secureflows-js";

/**
 * True when a restore/refresh `fetchSession` failure means the token is actually invalid — the
 * only case where clearing it and showing the signed-out CTA is correct. False for anything else
 * (e.g. a BILLING_GRACE_LOCK response, a network blip, a 5xx) so a still-valid token isn't wiped
 * out from under the user on a transient failure.
 */
export function isRestoreSignedOutError(e: unknown): boolean {
  return e instanceof SecureFlowsHttpError && isSessionSignedOutError(e);
}
