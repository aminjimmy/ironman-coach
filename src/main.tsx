import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { captureOAuthParams } from "./lib/sync";
import "./styles.css";

captureOAuthParams();

// Install app updates only while the app is in the background, so an update reload
// never interrupts a Strava login, a sync or a meal being logged.
let updateReady = false;
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    updateReady = true;
  },
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && updateReady) updateSW(true);
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
