/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.26 — скорость: сжатие gzip для страницы и ответов API (кроме realtime, файлов и бэкапа)
routerUse((e) => {
  const p = e.request.url.path;
  if (p.indexOf("/api/realtime") === 0 || p.indexOf("/api/files/") === 0 || p.indexOf("/api/vs/backup") === 0 || p.indexOf("/api/vs/file") === 0 || p.indexOf("/f/") >= 0 || /\.(png|jpe?g|webp|gif|mp4|mov|pdf|zip|xlsx|docx)$/i.test(p)) return e.next();
  const ae = e.request.header.get("Accept-Encoding") || "";
  if (ae.indexOf("gzip") < 0) return e.next();
  return $apis.gzip().func(e);
});
