// Service worker mínimo. Existe por dois motivos: o navegador só oferece
// "instalar" para sites que têm um, e ele garante que o app abra mesmo sem
// rede (com os dados que já estiverem em cache no navegador).
const CACHE = "contas-v1";
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

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  // Supabase e Google Fonts vão direto para a rede — nunca em cache.
  if (new URL(req.url).origin !== self.location.origin) return;

  // Navegação: rede primeiro, para o app nunca ficar preso numa versão velha.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then(r => { const copia = r.clone(); caches.open(CACHE).then(c => c.put(SHELL, copia)); return r; })
        .catch(() => caches.match(SHELL))
    );
    return;
  }

  // Assets têm hash no nome, então o cache nunca serve versão errada.
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(r => {
      if (r.ok) { const copia = r.clone(); caches.open(CACHE).then(c => c.put(req, copia)); }
      return r;
    }))
  );
});
