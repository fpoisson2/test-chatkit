import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { App } from "./App";
import { AuthProvider } from "./auth";
import { AppearanceSettingsProvider } from "./features/appearance/AppearanceSettingsContext";
import { I18nProvider } from "./i18n";
import { TooltipProvider } from "./components";
import { enableDevMocks } from "./dev-mock";
import "./styles/index.css";

// Active les mocks en mode développement pour tester sans backend
enableDevMocks();

// Register the PWA service worker in production. In development, remove any
// previously registered worker so it cannot serve stale Vite modules.
if ("serviceWorker" in navigator) {
  if (import.meta.env.PROD) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  } else {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => void registration.unregister());
    }).catch(() => {});
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <I18nProvider>
        <AuthProvider>
          <AppearanceSettingsProvider>
            <TooltipProvider>
              <App />
            </TooltipProvider>
          </AppearanceSettingsProvider>
        </AuthProvider>
      </I18nProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
