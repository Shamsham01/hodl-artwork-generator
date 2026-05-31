import { initApp } from "@multiversx/sdk-dapp/out/methods/initApp/initApp";
import React from "react";
import ReactDOM from "react-dom/client";
import { initConfig } from "./initConfig";
import App from "./App";
import "./index.css";

let rendered = false;
function render() {
  if (rendered) return;
  rendered = true;
  ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

// Safety net: render even if initApp hangs or rejects, so the page is never blank.
const fallback = setTimeout(() => {
  console.warn("[initApp] timed out, rendering app anyway");
  render();
}, 4000);

initApp(initConfig)
  .then(() => {
    clearTimeout(fallback);
    render();
  })
  .catch((err) => {
    clearTimeout(fallback);
    console.error("[initApp] wallet SDK init failed:", err);
    render();
  });
