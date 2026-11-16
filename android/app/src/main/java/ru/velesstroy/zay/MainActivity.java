package ru.velesstroy.zay;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/** ВЕЛЕССТРОЙ — заявки. Окно на сервер склада + мост: фото с камеры, файлы, сохранение Excel/PDF в «Загрузки», печать, «поделиться». */
public class MainActivity extends Activity {
    static final String DEF = "https://194-67-116-206.sslip.io/";
    static final int REQ_FILE = 7;
    WebView w;
    SharedPreferences sp;
    ValueCallback<Uri[]> fileCb;
    Uri camUri;
    boolean errShown;

    String base() { return sp.getString("server", DEF); }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        sp = getSharedPreferences("vs", MODE_PRIVATE);
        Window win = getWindow();
        win.setStatusBarColor(Color.parseColor("#1c2430"));
        w = new WebView(this);
        setContentView(w);
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setUserAgentString(s.getUserAgentString() + " VSApp/" + BuildConfigLite.VER);
        CookieManager.getInstance().setAcceptCookie(true);
        w.addJavascriptInterface(new Bridge(), "VSApp");
        w.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                String sc = u.getScheme() == null ? "" : u.getScheme();
                String host = Uri.parse(base()).getHost();
                boolean own = ("https".equals(sc) || "http".equals(sc)) && host != null && host.equals(u.getHost());
                String path = u.getPath() == null ? "" : u.getPath();
                // своя страница — внутри; файлы (фото, PDF), ссылки на другие сайты, WhatsApp, телефон, SMS — во внешних приложениях
                if (own && !path.startsWith("/api/files/") && !path.contains("/f/")) return false;
                openExternal(u);
                return true;
            }
            @Override
            public void onPageFinished(WebView v, String url) { if (!url.startsWith("data:")) errShown = false; }
            @Override
            public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame() && !errShown) { errShown = true; showError(); }
            }
        });
        w.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (fileCb != null) fileCb.onReceiveValue(null);
                fileCb = cb;
                camUri = null;
                boolean img = false;
                for (String a : p.getAcceptTypes()) if (a == null || a.isEmpty() || a.startsWith("image") || a.equals("*/*")) img = true;
                Intent cam = null;
                if (img && Build.VERSION.SDK_INT >= 29) {
                    try {
                        ContentValues cv = new ContentValues();
                        cv.put(MediaStore.Images.Media.DISPLAY_NAME, "vs_" + System.currentTimeMillis() + ".jpg");
                        cv.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
                        cv.put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/Velesstroy");
                        camUri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cv);
                        cam = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                        cam.putExtra(MediaStore.EXTRA_OUTPUT, camUri);
                        cam.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    } catch (Exception ex) { cam = null; camUri = null; }
                }
                try {
                    if (cam != null && p.isCaptureEnabled()) { startActivityForResult(cam, REQ_FILE); return true; }
                    Intent pick = p.createIntent();
                    if (p.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                    Intent ch = Intent.createChooser(pick, "Фото или файл");
                    if (cam != null) ch.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{cam});
                    startActivityForResult(ch, REQ_FILE);
                } catch (ActivityNotFoundException ex) {
                    fileCb = null; cb.onReceiveValue(null);
                    Toast.makeText(MainActivity.this, "Нет приложения для выбора файла", Toast.LENGTH_LONG).show();
                }
                return true;
            }
        });
        w.setDownloadListener(new android.webkit.DownloadListener() { public void onDownloadStart(String url, String ua, String cd, String mime, long len) { openExternal(Uri.parse(url)); } });
        if (b != null) w.restoreState(b); else w.loadUrl(base());
    }

    void openExternal(Uri u) {
        try {
            Intent i = "intent".equals(u.getScheme()) ? Intent.parseUri(u.toString(), Intent.URI_INTENT_SCHEME) : new Intent(Intent.ACTION_VIEW, u);
            startActivity(i);
        } catch (Exception e) {
            Toast.makeText(this, "Не открывается: " + u, Toast.LENGTH_LONG).show();
        }
    }

    void showError() {
        String html = "<html><head><meta name=viewport content='width=device-width,initial-scale=1'></head><body style='font-family:sans-serif;background:#1c2430;color:#fff;padding:24px'>"
                + "<h2 style='color:#f2b705'>ВЕЛЕССТРОЙ</h2><p>Нет связи с сервером склада.</p><p style='opacity:.7'>" + base() + "</p>"
                + "<button style='font-size:18px;padding:12px 20px;margin:8px 0;width:100%' onclick='VSApp.retry()'>Повторить</button>"
                + "<button style='font-size:15px;padding:10px 20px;margin:8px 0;width:100%' onclick='VSApp.server()'>Адрес сервера…</button></body></html>";
        w.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
    }

    void askServer() {
        final EditText e = new EditText(this);
        e.setText(base());
        new AlertDialog.Builder(this).setTitle("Адрес сервера").setView(e)
                .setPositiveButton("Сохранить", new android.content.DialogInterface.OnClickListener() { public void onClick(android.content.DialogInterface d, int x) {
                    String v = e.getText().toString().trim();
                    if (!v.startsWith("http")) v = "https://" + v;
                    if (!v.endsWith("/")) v = v + "/";
                    sp.edit().putString("server", v).apply();
                    w.loadUrl(v);
                } })
                .setNeutralButton("По умолчанию", new android.content.DialogInterface.OnClickListener() { public void onClick(android.content.DialogInterface d, int x) { sp.edit().remove("server").apply(); w.loadUrl(DEF); } })
                .setNegativeButton("Отмена", null).show();
    }

    @Override
    protected void onActivityResult(int rc, int res, Intent data) {
        super.onActivityResult(rc, res, data);
        if (rc != REQ_FILE || fileCb == null) return;
        Uri[] out = null;
        if (res == RESULT_OK) {
            if (data != null && data.getClipData() != null) {
                int n = data.getClipData().getItemCount();
                out = new Uri[n];
                for (int i = 0; i < n; i++) out[i] = data.getClipData().getItemAt(i).getUri();
            } else if (data != null && data.getData() != null) {
                out = new Uri[]{data.getData()};
            } else if (camUri != null) {
                out = new Uri[]{camUri};
            }
        }
        if (out == null && camUri != null) { try { getContentResolver().delete(camUri, null, null); } catch (Exception ignored) {} }
        else if (out != null && camUri != null && !out[0].equals(camUri)) { try { getContentResolver().delete(camUri, null, null); } catch (Exception ignored) {} }
        fileCb.onReceiveValue(out);
        fileCb = null;
        camUri = null;
    }

    @Override
    public void onBackPressed() {
        if (w.canGoBack()) w.goBack(); else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle o) { super.onSaveInstanceState(o); w.saveState(o); }

    @Override
    protected void onPause() { super.onPause(); CookieManager.getInstance().flush(); }

    class Bridge {
        @JavascriptInterface
        public String version() { return BuildConfigLite.VER; }

        @JavascriptInterface
        public void retry() { runOnUiThread(new Runnable() { public void run() { w.loadUrl(base()); } }); }

        @JavascriptInterface
        public void server() { runOnUiThread(new Runnable() { public void run() { askServer(); } }); }

        @JavascriptInterface
        public void print() {
            runOnUiThread(new Runnable() { public void run() {
                PrintManager pm = (PrintManager) getSystemService(PRINT_SERVICE);
                pm.print("ВЕЛЕССТРОЙ", w.createPrintDocumentAdapter("velesstroy"), new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build());
            } });
        }

        @JavascriptInterface
        public void share(final String text) {
            runOnUiThread(new Runnable() { public void run() {
                Intent i = new Intent(Intent.ACTION_SEND);
                i.setType("text/plain");
                i.putExtra(Intent.EXTRA_TEXT, text);
                startActivity(Intent.createChooser(i, "Отправить"));
            } });
        }

        @JavascriptInterface
        public void save(String name, final String mime, String b64) {
            try {
                byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
                final String safe = name.replaceAll("[\\\\/:*?\"<>|]", "_");
                Uri uri;
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues cv = new ContentValues();
                    cv.put(MediaStore.Downloads.DISPLAY_NAME, safe);
                    cv.put(MediaStore.Downloads.MIME_TYPE, mime);
                    cv.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Velesstroy");
                    uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                    try (OutputStream os = getContentResolver().openOutputStream(uri)) { os.write(bytes); }
                } else {
                    File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "Velesstroy");
                    dir.mkdirs();
                    File f = new File(dir, safe);
                    try (FileOutputStream os = new FileOutputStream(f)) { os.write(bytes); }
                    uri = null;
                }
                final Uri fu = uri;
                runOnUiThread(new Runnable() { public void run() {
                    Toast.makeText(MainActivity.this, "Сохранено: Загрузки/Velesstroy/" + safe, Toast.LENGTH_LONG).show();
                    if (fu != null) {
                        try {
                            Intent i = new Intent(Intent.ACTION_VIEW);
                            i.setDataAndType(fu, mime);
                            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                            startActivity(i);
                        } catch (Exception ignored) { }
                    }
                } });
            } catch (final Exception e) {
                runOnUiThread(new Runnable() { public void run() { Toast.makeText(MainActivity.this, "Не сохранилось: " + e.getMessage(), Toast.LENGTH_LONG).show(); } });
            }
        }
    }
}
