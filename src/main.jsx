import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

// O manifest e o service worker são injetados daqui, e não no index.html,
// porque precisam do caminho base correto — no GitHub Pages o app vive em
// /ControlMoney/, não na raiz do domínio.
const base = import.meta.env.BASE_URL;

const manifest = document.createElement("link");
manifest.rel = "manifest";
manifest.href = base + "manifest.webmanifest";
document.head.appendChild(manifest);

const apple = document.createElement("link");
apple.rel = "apple-touch-icon";
apple.href = base + "icone-apple.png";
document.head.appendChild(apple);

// O Chrome costuma emitir `beforeinstallprompt` durante o carregamento —
// antes do React montar. Se só o componente escutasse, o evento passaria
// direto e o botão automático nunca apareceria. Guardamos aqui, o mais cedo
// possível, e avisamos a interface quando ela já estiver de pé.
window.__promptInstalar = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  window.__promptInstalar = e;
  window.dispatchEvent(new Event("prompt-instalar-pronto"));
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(base + "sw.js", { scope: base }).catch(() => {
      // Sem service worker o app funciona igual; só não oferece instalação.
    });
  });
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
