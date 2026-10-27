package vn.dangtq.zaloweb

import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import java.io.ByteArrayInputStream
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * Serves Zalo Web's main stylesheet without one rule that makes the whole page restyle dozens of
 * times whenever Zalo renders something (opening a chat, switching tabs).
 *
 * `.mini-chat__message:has(.mini-chat__sel-check)>*` (the desktop mini-chat windows, never shown
 * in this app) gives Chrome's :has() invalidation a "whole subtree" set. Zalo also has :has()
 * rules with catch-all arguments (`:not(:has(:first-child))`), so nearly every element it inserts
 * sends html, #app-page and #container through that set, and every layout read afterwards
 * restyles all ~1,600 elements. Measured on the phone on 2026-10-27: opening a chat blocked the
 * page for ~730 ms with the rule, ~370 ms without.
 *
 * The file name carries a content hash, so the patched copy is cached on disk for good; on any
 * failure the request goes to the network untouched.
 */
class ZaloCss(cacheRoot: File, private val userAgent: String) {
    private val dir = File(cacheRoot, "zalo-css")

    /** Called on a WebView background thread. */
    fun intercept(request: WebResourceRequest): WebResourceResponse? {
        val url = request.url
        val name = url.lastPathSegment ?: return null
        if (request.method != "GET" || url.host != STATIC_HOST || !MAIN_CSS.matches(name)) return null
        val css = try {
            synchronized(this) { cached(name) ?: download(url.toString(), name) }
        } catch (e: IOException) {
            null
        } ?: return null
        return WebResourceResponse(
            "text/css", "utf-8", 200, "OK",
            mapOf("Access-Control-Allow-Origin" to "*"),
            ByteArrayInputStream(css)
        )
    }

    private fun cached(name: String): ByteArray? = File(dir, name).takeIf { it.isFile }?.readBytes()

    private fun download(url: String, name: String): ByteArray? {
        val conn = URL(url).openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = 10_000
            conn.readTimeout = 20_000
            conn.setRequestProperty("User-Agent", userAgent)
            if (conn.responseCode != HttpURLConnection.HTTP_OK) return null
            val text = conn.inputStream.use { it.readBytes() }.toString(Charsets.UTF_8)
            val patched = SLOW_RULE.replace(text, "").toByteArray(Charsets.UTF_8)
            store(name, patched)
            return patched
        } finally {
            conn.disconnect()
        }
    }

    /** Keeps only the current version: Zalo ships a new file name with each update. */
    private fun store(name: String, css: ByteArray) {
        dir.mkdirs()
        val tmp = File(dir, "$name.tmp")
        tmp.writeBytes(css)
        if (!tmp.renameTo(File(dir, name))) {
            tmp.delete()
            return
        }
        dir.listFiles()?.filter { it.name != name }?.forEach { it.delete() }
    }

    private companion object {
        const val STATIC_HOST = "zalo-chat-static.zadn.vn"
        val MAIN_CSS = Regex("""web-startup\.[0-9a-f]+\.css""")
        val SLOW_RULE = Regex("""\.mini-chat__message:has\(\.mini-chat__sel-check\)>\*\{[^}]*\}""")
    }
}
