// Sobe a versão do package.json em uma casa de patch (1.0.0 -> 1.0.1).
// Chamado pelo hook de pre-commit a cada commit, para que a versão mostrada
// na tela acompanhe o histórico sem ninguém precisar lembrar de mexer à mão.
//
// Rodar solto (`node scripts/bump-version.mjs`) também sobe a versão, útil
// para quem quiser avançar sem commitar.
import { readFileSync, writeFileSync } from "node:fs";

const caminho = new URL("../package.json", import.meta.url);
const pkg = JSON.parse(readFileSync(caminho, "utf-8"));

const partes = String(pkg.version || "0.0.0").split(".").map((n) => parseInt(n, 10) || 0);
while (partes.length < 3) partes.push(0);
partes[2] += 1;
pkg.version = partes.join(".");

// Mantém a mesma formatação (2 espaços, quebra final) para o diff ficar limpo.
writeFileSync(caminho, JSON.stringify(pkg, null, 2) + "\n");
console.log(`Versão -> ${pkg.version}`);
