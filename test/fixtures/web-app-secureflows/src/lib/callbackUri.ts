import { SECUREFLOWS_PUBLISHED_ORIGIN } from "../config/secureflows";

function getPublishedOrigin(): string {
  return SECUREFLOWS_PUBLISHED_ORIGIN.replace(/\/+$/, "");
}

/** Allowlisted callback URL — must match dashboard entry for this deployment host. */
export function getCallbackRedirectUri(): string {
  return `${getPublishedOrigin()}/callback`;
}

/** Post-logout landing page — use a non-callback route. */
export function getLogoutRedirectUri(): string {
  return `${getPublishedOrigin()}/`;
}

export const CALLBACK_PATH = "/callback";

export function isCallbackPath(): boolean {
  return window.location.pathname === CALLBACK_PATH;
}
