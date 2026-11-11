// VELESSTROY 1.9.8 — страница программы сохраняется в телефоне, чтобы открываться без интернета.
// Всегда сначала берём свежую с сервера; копия — только если сети нет. Данные (API) не кешируются здесь.
const C = "vs-shell-2";
// копия без «перенаправлений» — иначе браузер не откроет её как страницу
const clean = (r) => r.redirected ? r.blob().then((b) => new Response(b, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } })) : Promise.resolve(r);
const keep = (r) => r && r.ok ? clean(r.clone()).then((x) => caches.open(C).then((c) => c.put("/", x))) : null;
self.addEventListener("install", (e) => { e.waitUntil(fetch("/", { cache: "no-store" }).then(keep).catch(() => {}).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== C).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  if (u.pathname === "/" || u.pathname === "/index.html") {
    e.respondWith(fetch(e.request).then((r) => { keep(r); return r; })
      .catch(() => caches.match("/").then((r) => r || Response.error())));
  }
});
