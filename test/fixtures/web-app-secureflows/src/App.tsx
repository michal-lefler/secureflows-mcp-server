import { useSecureFlows } from "./lib/secureFlowsSession";

export default function App() {
  const { session, hasToken, userEmail, loading, redirecting, error, login, logout } =
    useSecureFlows();

  if (loading) {
    return <p>Restoring secureFlows session…</p>;
  }

  // Gate Continue on stored token, not `session`. BILLING_GRACE_LOCK / 5xx / network restore
  // failures keep the token and must stay on the signed-in shell with a banner.
  if (!hasToken) {
    return (
      <div>
        {error ? <p>{error}</p> : null}
        <p>Sign in with secureFlows to open your app session.</p>
        <button type="button" onClick={() => void login()} disabled={redirecting}>
          {redirecting ? "Redirecting..." : "Continue with secureFlows"}
        </button>
      </div>
    );
  }

  return (
    <div>
      {error ? (
        <p role="alert" style={{ color: "#b91c1c" }}>
          {error}
        </p>
      ) : null}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: "12px",
          marginBottom: "16px",
        }}
      >
        {userEmail ? (
          <span style={{ color: "var(--muted-foreground, #64748b)", fontSize: "14px" }}>{userEmail}</span>
        ) : null}
        <button type="button" onClick={() => void logout()}>
          Sign out
        </button>
      </header>
      {session ? (
        <>
          <p>Signed in. Session payload:</p>
          <pre>{JSON.stringify(session, null, 2)}</pre>
        </>
      ) : (
        <p>Signed in. Session data could not be loaded.</p>
      )}
    </div>
  );
}
