import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./index.css";

const root = document.getElementById("root");
if (!root) {
  document.body.textContent = "Missing #root";
} else {
  try {
    createRoot(root).render(<App />);
  } catch (err) {
    root.innerHTML = `<div class="boot"><p>Boot failed</p><pre style="max-width:90vw;white-space:pre-wrap">${String(err)}</pre></div>`;
  }
}
