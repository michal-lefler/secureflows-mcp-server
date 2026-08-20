import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import SecureFlowsCallback from "./SecureFlowsCallback";
import { isCallbackPath } from "./lib/callbackUri";
import { SecureFlowsProvider } from "./lib/secureFlowsSession";

const root = createRoot(document.getElementById("root")!);

if (isCallbackPath()) {
  root.render(
    <StrictMode>
      <SecureFlowsCallback />
    </StrictMode>,
  );
} else {
  root.render(
    <StrictMode>
      <SecureFlowsProvider>
        <App />
      </SecureFlowsProvider>
    </StrictMode>,
  );
}
