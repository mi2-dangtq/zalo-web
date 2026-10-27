package vn.dangtq.zaloweb

import android.app.DownloadManager
import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.webkit.CookieManager
import android.webkit.DownloadListener
import android.webkit.JavascriptInterface
import android.webkit.MimeTypeMap
import android.webkit.URLUtil
import org.json.JSONObject
import java.io.IOException
import java.io.OutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID

/**
 * http(s) downloads go through DownloadManager with the WebView's cookies and UA.
 * blob:/data: downloads are read in JS (see inject.js) and streamed through [Bridge] into
 * Download/ via MediaStore — no storage permission needed.
 */
class Downloads(private val activity: MainActivity) : DownloadListener {

    val bridge = Bridge()

    override fun onDownloadStart(
        url: String,
        userAgent: String?,
        contentDisposition: String?,
        mimeType: String?,
        contentLength: Long
    ) {
        when {
            url.startsWith("blob:") || url.startsWith("data:") -> {
                val name = if (contentDisposition.isNullOrBlank()) "" else {
                    URLUtil.guessFileName(url, contentDisposition, mimeType)
                }
                val js = "window.__zwSaveUrl && window.__zwSaveUrl(" +
                    "${JSONObject.quote(url)}, ${JSONObject.quote(name)}, ${JSONObject.quote(mimeType ?: "")})"
                activity.webView.evaluateJavascript(js, null)
            }
            url.startsWith("https://") || url.startsWith("http://") ->
                enqueue(url, userAgent, contentDisposition, mimeType)
            else -> activity.toast("Không hỗ trợ tải liên kết này")
        }
    }

    private fun enqueue(url: String, userAgent: String?, contentDisposition: String?, mimeType: String?) {
        try {
            val name = buildFileName(URLUtil.guessFileName(url, contentDisposition, mimeType), mimeType)
            val request = DownloadManager.Request(Uri.parse(url)).apply {
                CookieManager.getInstance().getCookie(url)?.let { addRequestHeader("Cookie", it) }
                addRequestHeader("User-Agent", userAgent ?: activity.webView.settings.userAgentString)
                activity.webView.url?.let { addRequestHeader("Referer", it) }
                if (!mimeType.isNullOrBlank()) setMimeType(mimeType)
                setTitle(name)
                setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
            }
            val dm = activity.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            dm.enqueue(request)
            activity.toast("Đang tải: $name")
        } catch (e: Exception) {
            activity.toast("Không tải được: ${e.message}")
        }
    }

    /** A Download/ entry being written in chunks from JS; IS_PENDING until [Bridge.finishSave]. */
    private class PendingSave(val uri: Uri, val out: OutputStream)

    // Bridge calls all arrive on the single JavaBridge thread, so no locking is needed.
    private val saves = HashMap<String, PendingSave>()

    inner class Bridge {
        /** Small payloads (data: URLs): [data] is plain base64 or a data: URL. */
        @JavascriptInterface
        fun saveBase64(data: String, fileName: String?, mime: String?) {
            val id = beginSave(fileName, mime)
            if (id.isEmpty()) return
            val payload = if (data.startsWith("data:")) data.substringAfter(',') else data
            if (appendSave(id, payload)) finishSave(id)
        }

        /**
         * Blobs are streamed in base64 chunks (begin → append… → finish) so a large file never
         * has to exist as one giant string or byte array. Returns "" when the file can't be created.
         */
        @JavascriptInterface
        fun beginSave(fileName: String?, mime: String?): String {
            return try {
                val name = buildFileName(fileName, mime)
                val resolver = activity.contentResolver
                val values = ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME, name)
                    put(MediaStore.MediaColumns.MIME_TYPE, resolveMime(name, mime))
                    put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                    put(MediaStore.MediaColumns.IS_PENDING, 1)
                }
                val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                    ?: throw IOException("MediaStore từ chối tạo file")
                val out = try {
                    resolver.openOutputStream(uri) ?: throw IOException("Không mở được file để ghi")
                } catch (t: Throwable) {
                    resolver.delete(uri, null, null)
                    throw t
                }
                val id = UUID.randomUUID().toString()
                saves[id] = PendingSave(uri, out)
                id
            } catch (t: Throwable) {
                activity.toast("Lưu file thất bại: ${t.message}")
                ""
            }
        }

        @JavascriptInterface
        fun appendSave(id: String, base64: String): Boolean {
            val save = saves[id] ?: return false
            return try {
                save.out.write(Base64.decode(base64, Base64.DEFAULT))
                true
            } catch (t: Throwable) {
                abortSave(id)
                activity.toast("Lưu file thất bại: ${t.message}")
                false
            }
        }

        @JavascriptInterface
        fun finishSave(id: String) {
            val save = saves.remove(id) ?: return
            try {
                save.out.close()
                val resolver = activity.contentResolver
                resolver.update(
                    save.uri,
                    ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) },
                    null,
                    null
                )
                activity.toast("Đã lưu vào Download: ${savedName(save.uri) ?: "file"}")
            } catch (t: Throwable) {
                activity.contentResolver.delete(save.uri, null, null)
                activity.toast("Lưu file thất bại: ${t.message}")
            }
        }

        @JavascriptInterface
        fun abortSave(id: String) {
            val save = saves.remove(id) ?: return
            try {
                save.out.close()
            } catch (ignored: Throwable) {
            }
            activity.contentResolver.delete(save.uri, null, null)
        }

        @JavascriptInterface
        fun toast(message: String) {
            activity.toast(message)
        }

        /** inject.js calls this once Zalo's UI (or the login page) has rendered. */
        @JavascriptInterface
        fun ready() {
            activity.runOnUiThread { activity.hideSplash() }
        }

        /** inject.js reports Zalo's page background ("#rrggbb") whenever its light/dark theme changes. */
        @JavascriptInterface
        fun pageColor(color: String) {
            activity.runOnUiThread { activity.setPageColor(color) }
        }
    }

    /** MediaStore renames duplicates ("x (1).jpg"), so read back the name it actually used. */
    private fun savedName(uri: Uri): String? =
        activity.contentResolver
            .query(uri, arrayOf(MediaStore.MediaColumns.DISPLAY_NAME), null, null, null)
            ?.use { if (it.moveToFirst()) it.getString(0) else null }

    private fun normalizeMime(mime: String?): String? =
        mime?.substringBefore(';')?.trim()?.lowercase()?.takeIf { it.isNotEmpty() }

    /** Prefer the extension's MIME type when the blob type is missing or generic. */
    private fun resolveMime(name: String, mime: String?): String {
        val given = normalizeMime(mime)
        if (given != null && given != "application/octet-stream") return given
        val ext = name.substringAfterLast('.', "").lowercase()
        return MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "application/octet-stream"
    }

    private fun buildFileName(fileName: String?, mime: String?): String {
        var name = (fileName ?: "")
            .replace(Regex("""[\\/:*?"<>|\u0000-\u001F]"""), "_")
            .trim()
            .trimStart('.')
            .take(150)
        if (name.isEmpty()) {
            name = "zalo_" + SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())
        }
        val ext = name.substringAfterLast('.', "")
        if (ext.isEmpty() || ext.length > 8 || ext == "bin") {
            val type = normalizeMime(mime)
            val guessed = type?.let { MimeTypeMap.getSingleton().getExtensionFromMimeType(it) ?: fallbackExtension(it) }
            if (guessed != null) {
                name = if (ext == "bin") name.dropLast(4) + ".$guessed" else "$name.$guessed"
            }
        }
        return name
    }

    private fun fallbackExtension(mime: String): String? = when (mime) {
        "image/jpg" -> "jpg"
        "image/heic" -> "heic"
        "audio/x-m4a", "audio/m4a" -> "m4a"
        "audio/aac" -> "aac"
        "video/quicktime" -> "mov"
        "application/x-zip-compressed" -> "zip"
        else -> null
    }
}
