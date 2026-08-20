import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { SecureFlows, type SessionJson } from "secureflows-js";

import {
  SECUREFLOWS_APP_ID,
  SECUREFLOWS_ORIGIN,
  SECUREFLOWS_WORKSPACE,
} from "../config/secureflows";
import { getCallbackRedirectUri, getLogoutRedirectUri } from "./callbackUri";
import { isRestoreSignedOutError } from "./sessionRestoreError";
import { clearSignedOutLocalState } from "./signedOutLocalState";

type SecureFlowsContextValue = {
  session: SessionJson | null;
  /** True while a session token is stored. Gate Continue CTA on this, not on `session`. */
  hasToken: boolean;
  userEmail: string | null;
  loading: boolean;
  redirecting: boolean;
  error: string | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  /**
   * Clear token + React auth UI state so the Continue CTA returns.
   * Use on mid-flow `isSessionSignedOutError` (Save/API) — do not call `sf.logout()` alone
   * (that leaves a signed-in shell and a dead Sign out button, because `logoutWithRedirect`
   * no-ops when there is no token).
   */
  handleSignedOut: () => void;
  sf: SecureFlows;
};

const SecureFlowsContext = createContext<SecureFlowsContextValue | null>(null);

export function SecureFlowsProvider({ children }: { children: ReactNode }) {
  const sf = useMemo(
    () =>
      new SecureFlows({
        origin: SECUREFLOWS_ORIGIN,
        appId: SECUREFLOWS_APP_ID,
        workspace: SECUREFLOWS_WORKSPACE,
      }),
    [],
  );

  const [session, setSession] = useState<SessionJson | null>(null);
  const [hasToken, setHasToken] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignedOut = useCallback(() => {
    clearSignedOutLocalState({
      clearToken: () => sf.logout(),
      clearSessionUi: () => {
        setHasToken(false);
        setSession(null);
        setUserEmail(null);
        setError(null);
      },
    });
  }, [sf]);

  const login = useCallback(async () => {
    setError(null);
    setRedirecting(true);

    try {
      const data = await sf.login({ redirectUri: getCallbackRedirectUri() });
      setHasToken(true);
      setSession(data);
      const token = sf.getToken();
      if (token) {
        try {
          const identity = await sf.fetchSessionIdentity(token);
          setUserEmail(identity.email);
        } catch {
          setUserEmail(null);
        }
      } else {
        setUserEmail(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setHasToken(Boolean(sf.getToken()));
      setSession(null);
      setUserEmail(null);
    } finally {
      setRedirecting(false);
    }
  }, [sf]);

  const logout = useCallback(async () => {
    setError(null);
    try {
      // Token already cleared (e.g. mid-flow handleSignedOut) — still return to Continue CTA.
      if (!sf.getToken()) {
        handleSignedOut();
        return;
      }
      await sf.logoutWithRedirect({ redirectUri: getLogoutRedirectUri() });
      setHasToken(false);
      setSession(null);
      setUserEmail(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [sf, handleSignedOut]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const token = sf.getToken();
      if (!token) {
        if (!cancelled) {
          setHasToken(false);
          setLoading(false);
        }
        return;
      }

      setError(null);
      try {
        const data = await sf.fetchSession(token);
        if (!cancelled) {
          setHasToken(true);
          setSession(data);
        }
        try {
          const identity = await sf.fetchSessionIdentity(token);
          if (!cancelled) {
            setUserEmail(identity.email);
          }
        } catch {
          if (!cancelled) {
            setUserEmail(null);
          }
        }
      } catch (e) {
        // Only clear the token on an actual signed-out signal (401/410/etc.) — a billing lock,
        // network blip, or other transient failure must NOT sign the user out from under them.
        // Calling sf.logout() unconditionally here wipes a still-valid token on every restore
        // error, including BILLING_GRACE_LOCK, forcing a full re-login for a non-auth failure.
        const signedOut = isRestoreSignedOutError(e);
        if (!cancelled) {
          if (signedOut) {
            // Stale/expired token (incl. legacy JSON 403 Access denied) → Continue CTA, no error banner.
            handleSignedOut();
          } else {
            // Billing lock / network / 5xx — keep token + signed-in shell; banner, not Continue CTA.
            setHasToken(true);
            setError(e instanceof Error ? e.message : String(e));
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sf, handleSignedOut]);

  const value = useMemo(
    () => ({
      session,
      hasToken,
      userEmail,
      loading,
      redirecting,
      error,
      login,
      logout,
      handleSignedOut,
      sf,
    }),
    [session, hasToken, userEmail, loading, redirecting, error, login, logout, handleSignedOut, sf],
  );

  return (
    <SecureFlowsContext.Provider value={value}>{children}</SecureFlowsContext.Provider>
  );
}

export function useSecureFlows(): SecureFlowsContextValue {
  const ctx = useContext(SecureFlowsContext);
  if (!ctx) {
    throw new Error("useSecureFlows must be used within SecureFlowsProvider");
  }
  return ctx;
}
