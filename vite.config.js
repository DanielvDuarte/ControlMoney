import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

// A versão exibida na tela vem daqui, lida do package.json no momento do
// build. Assim não há um número solto numa segunda fonte para esquecer de
// atualizar: o hook de pre-commit sobe o package.json e a tela acompanha.
const { version } = JSON.parse(readFileSync("./package.json", "utf-8"));

// No GitHub Pages o site fica em /<nome-do-repo>/, não na raiz do domínio —
// sem esse base os arquivos JS/CSS são procurados no lugar errado e a tela
// fica em branco. Em hosts que servem na raiz (Cloudflare, Netlify, Vercel),
// defina VITE_BASE=/ no build.
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE || "/ControlMoney/",
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
});
