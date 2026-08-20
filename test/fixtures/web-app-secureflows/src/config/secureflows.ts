/** secureFlows hosted origin — production or staging. */
export const SECUREFLOWS_ORIGIN = "https://www.secure-flows.com";

/** From workspace dashboard (Phase 1). */
export const SECUREFLOWS_WORKSPACE = "REPLACE_WORKSPACE";

/** From application registration (Phase 1). */
export const SECUREFLOWS_APP_ID = "REPLACE_APP_ID";

/**
 * Exact preview/deployment host (Lovable: `id-preview--….lovable.app` or `….lovableproject.com`).
 * NOT the editor chrome URL. Use the allowlist error message if unsure.
 */
export const SECUREFLOWS_PUBLISHED_ORIGIN = "https://REPLACE_PREVIEW_HOST";

/** Register this exact URL in the dashboard allowlist (hosted login returns here). */
export const SECUREFLOWS_ALLOWLIST_CALLBACK = `${SECUREFLOWS_PUBLISHED_ORIGIN}/callback`;
