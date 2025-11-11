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
