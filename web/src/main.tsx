import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/landing.css";
import "./styles/console.css";
import { Landing } from "./pages/Landing";
import { Console } from "./pages/Console";
import { RunPage } from "./pages/RunPage";
import { NotFound } from "./pages/NotFound";
import { BorrowerPage } from "./pages/BorrowerPage";
import { PortalPage } from "./pages/PortalPage";
import { SafetyPage } from "./pages/SafetyPage";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => window.scrollTo(0, 0), [pathname]);
  return null;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/desk" element={<Console />} />
        {/* Old links and the first demo video point here. */}
        <Route path="/console" element={<Navigate to="/desk" replace />} />
        <Route path="/run" element={<RunPage />} />
        <Route path="/borrowers/:id" element={<BorrowerPage />} />
        <Route path="/borrowers" element={<Navigate to="/borrowers/kopi" replace />} />
        <Route path="/portal/:id" element={<PortalPage />} />
        <Route path="/portal" element={<Navigate to="/portal/nimbus" replace />} />
        <Route path="/safety" element={<SafetyPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
