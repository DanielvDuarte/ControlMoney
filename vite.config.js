import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// No GitHub Pages o site fica em /<nome-do-repo>/, não na raiz do domínio —
// sem esse base os arquivos JS/CSS são procurados no lugar errado e a tela
// fica em branco. Em hosts que servem na raiz (Cloudflare, Netlify, Vercel),
// defina VITE_BASE=/ no build.
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE || "/ControlMoney/",
});
