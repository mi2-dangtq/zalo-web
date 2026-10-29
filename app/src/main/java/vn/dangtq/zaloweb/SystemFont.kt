package vn.dangtq.zaloweb

import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileInputStream

/**
 * The font the phone draws its own UI with, so Zalo's text can use it too ("Font của máy").
 *
 * WebView doesn't follow the HyperOS theme font: its renderer reads Android's stock font list, so
 * even `sans-serif` is Roboto there. So the app reads the file itself and serves it to the page at
 * [FONT_URL], and inject.js re-declares Zalo's own font (SegoeuiPc) with it.
 *  - A font applied in Themes: HyperOS keeps it as /data/system/theme/fonts/Roboto-Regular.ttf
 *    (every other name in that folder links to it).
 *  - Otherwise the stock MiSans, a variable font, so its bold stays real.
 */
class SystemFont {

    class Current(val file: File, val version: String) {
        /** Changes with the file, so a newly chosen font isn't taken from WebView's cache. */
        val url get() = "$FONT_URL?v=$version"
    }

    /** The font file the phone uses now, if this app may read it (SELinux can say no). */
    fun current(): Current? {
        for (path in CANDIDATES) {
            val file = File(path)
            try {
                if (!file.isFile || file.length() == 0L) continue
                FileInputStream(file).use { it.read() }
                return Current(file, "${file.lastModified()}-${file.length()}")
            } catch (e: Exception) {
                // not readable: try the next one
            }
        }
        return null
    }

    /** Serves [current] at [FONT_URL]. Called on a WebView background thread. */
    fun intercept(request: WebResourceRequest): WebResourceResponse? {
        val url = request.url
        if (request.method != "GET" || url.host != HOST || url.path != PATH) return null
        val font = current() ?: return notFound()
        return try {
            WebResourceResponse(
                "font/ttf", null, 200, "OK",
                mapOf("Cache-Control" to "no-cache"),
                FileInputStream(font.file)
            )
        } catch (e: Exception) {
            notFound()
        }
    }

    // The page then falls back to Zalo's own font face.
    private fun notFound() =
        WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), ByteArrayInputStream(ByteArray(0)))

    private companion object {
        const val HOST = "chat.zalo.me"
        const val PATH = "/__zw/system-font"
        const val FONT_URL = "https://$HOST$PATH"
        val CANDIDATES = listOf(
            "/data/system/theme/fonts/Roboto-Regular.ttf",
            "/system/fonts/MiSansVF.ttf"
        )
    }
}
