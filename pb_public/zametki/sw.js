// Заметки ВЕЛЕССТРОЙ — работа без интернета: страница хранится в телефоне
const C = "vs-zametki-v1";
const FILES = ["/zametki/", "/zametki/index.html", "/zametki/manifest.webmanifest", "/zametki/icon.svg"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(C).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== C).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || !u.pathname.startsWith("/zametki/")) return;
  // сначала сеть (свежая версия), без сети — из телефона
  e.respondWith(fetch(e.request).then((r) => { const cp = r.clone(); caches.open(C).then((c) => c.put(e.request, cp)); return r; })
    .catch(() => caches.match(e.request).then((r) => r || caches.match("/zametki/index.html"))));
});
// 1.9.18: нажатие на уведомление-напоминание открывает «Заметки»
self.addEventListener("notificationclick", (e) => { e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => { const c = cs.find((x) => x.url.includes("/zametki/")); return c ? c.focus() : self.clients.openWindow("/zametki/"); })); });
