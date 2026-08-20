import { useEffect, useMemo, useRef, useState } from "react";
import { SecureFlows } from "secureflows-js";

import {
  SECUREFLOWS_APP_ID,
  SECUREFLOWS_ORIGIN,
  SECUREFLOWS_WORKSPACE,
} from "./config/secureflows";
import { getCallbackRedirectUri } from "./lib/callbackUri";

/**
 * Unguarded /callback route — parses sessionToken from URL (Google OAuth-style return).
 * Must NOT sit under RequireAuth or any authenticated layout.
 */
export default function SecureFlowsCallback() {
  const sf = useMemo(
    () =>
      new SecureFlows({
        origin: SECUREFLOWS_ORIGIN,
        appId: SECUREFLOWS_APP_ID,
        workspace: SECUREFLOWS_WORKSPACE,
      }),
    [],
  );

  const [error, setError] = useState<string | null>(null);
  // React StrictMode double-invokes effects in dev — without this guard, a second concurrent
  // ensureSession() call can fail (e.g. the URL/query it needs was already consumed by the
  // first) and its catch clears the token the first call just successfully stored, dropping the
  // user back on the signed-out CTA right after a login that actually succeeded.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      try {
        await sf.ensureSession({ redirectUri: getCallbackRedirectUri() });
        window.location.replace("/");
      } catch (e) {
        sf.logout();
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [sf]);

  if (error) {
    return (
      <div>
        <p>Sign-in failed: {error}</p>
        <button
          type="button"
          onClick={() => {
            window.location.replace("/");
          }}
        >
          Start over
        </button>
      </div>
    );
  }

  return <p>Completing sign-in…</p>;
}
