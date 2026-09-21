// Service worker mínimo. Existe por dois motivos: o navegador só oferece
// "instalar" para sites que têm um, e ele garante que o app abra mesmo sem
// rede (com os dados que já estiverem em cache no navegador).
// v2: a troca de versão apaga o cache antigo, que guardava o manifest com o
// nome "ControlMoney — Contas do mês" e segurava o título repetido na janela.
const CACHE = "contas-v2";
const SHELL = "./index.html";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.add(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Rede primeiro, cache só quando não houver conexão.
const redePrimeiro = (req, chave = req) =>
  fetch(req)
    .then(r => { if (r.ok) { const copia = r.clone(); caches.open(CACHE).then(c => c.put(chave, copia)); } return r; })
    .catch(() => caches.match(chave));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  // Supabase e Google Fonts vão direto para a rede — nunca em cache.
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navegação: rede primeiro, para o app nunca ficar preso numa versão velha.
  if (req.mode === "navigate") { e.respondWith(redePrimeiro(req, SHELL)); return; }

  // O manifest não tem hash no nome. Servido do cache, o navegador nunca
  // enxergaria uma mudança de nome ou ícone no app já instalado.
  if (url.pathname.endsWith(".webmanifest")) { e.respondWith(redePrimeiro(req)); return; }

  // Os demais assets têm hash no nome, então o cache nunca serve versão errada.
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(r => {
      if (r.ok) { const copia = r.clone(); caches.open(CACHE).then(c => c.put(req, copia)); }
      return r;
    }))
  );
});
