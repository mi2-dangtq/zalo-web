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
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * http(s) downloads go through DownloadManager with the WebView's cookies and UA.
 * blob:/data: downloads are read in JS (see inject.js) and handed to [Bridge.saveBase64],
 * which writes them to Download/ through MediaStore — no storage permission needed.
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

    inner class Bridge {
        /** Called from inject.js on the JavaBridge thread; [data] is plain base64 or a data: URL. */
        @JavascriptInterface
        fun saveBase64(data: String, fileName: String?, mime: String?) {
            try {
                val payload = if (data.startsWith("data:")) data.substringAfter(',') else data
                val bytes = Base64.decode(payload, Base64.DEFAULT)
                val saved = writeToDownloads(bytes, fileName, mime)
                activity.toast("Đã lưu vào Download: $saved")
            } catch (e: Exception) {
                activity.toast("Lưu file thất bại: ${e.message}")
            }
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
    }

    private fun writeToDownloads(bytes: ByteArray, fileName: String?, mime: String?): String {
        val name = buildFileName(fileName, mime)
        val type = resolveMime(name, mime)
        val resolver = activity.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, name)
            put(MediaStore.MediaColumns.MIME_TYPE, type)
            put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: throw IOException("MediaStore từ chối tạo file")
        try {
            val out = resolver.openOutputStream(uri) ?: throw IOException("Không mở được file để ghi")
            out.use { it.write(bytes) }
            values.clear()
            values.put(MediaStore.MediaColumns.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
        } catch (e: Exception) {
            resolver.delete(uri, null, null)
            throw e
        }
        return name
    }

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
