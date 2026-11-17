/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.26 — скорость: сжатие gzip для страницы и ответов API (кроме realtime, файлов и бэкапа)
routerUse((e) => {
  const p = e.request.url.path;
  if (p.indexOf("/api/realtime") === 0 || p.indexOf("/api/files/") === 0 || p.indexOf("/api/vs/backup") === 0 || p.indexOf("/api/vs/file") === 0 || p.indexOf("/f/") >= 0 || /\.(png|jpe?g|webp|gif|mp4|mov|pdf|zip|xlsx|docx|apk)$/i.test(p)) return e.next();
  const ae = e.request.header.get("Accept-Encoding") || "";
  if (ae.indexOf("gzip") < 0) return e.next();
  return $apis.gzip().func(e);
});

// 1.9.28: APK приложения — всегда с типом Android-пакета и именем файла (на сервере без /etc/mime.types Go отдаёт .apk как zip, и телефон не открывает)
routerAdd("GET", "/app/velesstroy-zayavki.apk", (e) => {
  const h = e.response.header();
  h.set("Content-Type", "application/vnd.android.package-archive");
  h.set("Content-Disposition", 'attachment; filename="velesstroy-zayavki.apk"');
  h.set("Cache-Control", "no-cache");
  return e.fileFS($os.dirFS(`${__hooks}/../pb_public/app`), "velesstroy-zayavki.apk");
});
