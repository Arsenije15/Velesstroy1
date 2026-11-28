/// <reference path="../pb_data/types.d.ts" />
// 1.9.64: маленькие картинки (200×200) для фото приёмки и УПД — помощник показывает их как доказательства, не грузя телефон
migrate((app) => {
  [["attachments", "file"], ["upd_photos", "file"], ["upd_docs", "file"]].forEach(([c, n]) => {
    const col = app.findCollectionByNameOrId(c); const f = col.fields.getByName(n);
    if (f && (f.thumbs || []).indexOf("200x200") < 0) { f.thumbs = (f.thumbs || []).concat(["200x200"]); app.save(col); }
  });
}, (app) => {});
