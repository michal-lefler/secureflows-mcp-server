/**
 * Clears secureFlows token storage and app auth UI so the Continue CTA returns.
 *
 * Use after `isSessionSignedOutError` / `isRestoreSignedOutError` on Save or other Session API
 * calls — never call `sf.logout()` alone. Clearing only the token leaves a signed-in shell and
 * makes Sign out a no-op (`logoutWithRedirect` returns early when there is no token).
 */
export function clearSignedOutLocalState(args: {
  clearToken: () => void;
  clearSessionUi: () => void;
}): void {
  args.clearToken();
  args.clearSessionUi();
}
