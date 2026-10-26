package vn.dangtq.zaloweb

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.webkit.CookieManager
import android.webkit.MimeTypeMap
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher
import org.json.JSONObject

class MainActivity : Activity() {

    companion object {
        const val HOME_URL = "https://chat.zalo.me/"
        private const val REQ_FILE_CHOOSER = 1001
        private const val REQ_MEDIA_PERMISSIONS = 1002

        private val ZALO_DOMAINS = listOf("zalo.me", "zaloapp.com", "zadn.vn", "zdn.vn", "zalo.vn")

        fun isZaloHost(host: String?): Boolean {
            if (host.isNullOrEmpty()) return false
            val h = host.lowercase()
            return ZALO_DOMAINS.any { h == it || h.endsWith(".$it") }
        }
    }

    lateinit var webView: WebView
        private set
    lateinit var prefs: Prefs
        private set

    private lateinit var downloads: Downloads
    private var injectJs = ""
    private var injectCss = ""
    private var mobileCss = ""
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingPermission: PermissionRequest? = null
    private var clearHistoryOnLoad = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        injectJs = readAsset("inject.js")
        injectCss = readAsset("inject.css")
        mobileCss = readAsset("zalo-mobile.css")

        // Lets chrome://inspect on a PC attach to this WebView for writing custom CSS.
        WebView.setWebContentsDebuggingEnabled(true)

        val root = FrameLayout(this)
        root.setBackgroundColor(getColor(R.color.background))
        webView = WebView(this)
        root.addView(
            webView,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        )
        setContentView(root)
        setupEdgeToEdge(root)

        downloads = Downloads(this)
        configureWebView()
        SettingsUi(this, root).attach()
        setupBackNavigation()

        webView.loadUrl(HOME_URL)
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush()
    }

    override fun onDestroy() {
        (webView.parent as? ViewGroup)?.removeView(webView)
        webView.destroy()
        super.onDestroy()
    }

    // ---------------------------------------------------------------- WebView setup

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        val s = webView.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        @Suppress("DEPRECATION")
        s.databaseEnabled = true
        s.mediaPlaybackRequiresUserGesture = false
        s.javaScriptCanOpenWindowsAutomatically = true
        s.setSupportMultipleWindows(false)
        s.allowFileAccess = false
        s.allowContentAccess = true
        s.useWideViewPort = true
        s.loadWithOverviewMode = true
        s.setSupportZoom(true)
        s.builtInZoomControls = true
        s.displayZoomControls = false
        s.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        s.textZoom = prefs.textZoom
        s.userAgentString = desktopUserAgent()

        val cookies = CookieManager.getInstance()
        cookies.setAcceptCookie(true)
        cookies.setAcceptThirdPartyCookies(webView, true)

        webView.addJavascriptInterface(downloads.bridge, "AndroidBridge")
        webView.setDownloadListener(downloads)
        webView.webViewClient = ZaloWebViewClient()
        webView.webChromeClient = ZaloChromeClient()
    }

    /** Chrome-on-Windows UA whose major version matches the real WebView, so Zalo serves the desktop site. */
    private fun desktopUserAgent(): String {
        val defaultUa = WebSettings.getDefaultUserAgent(this)
        val major = Regex("""Chrome/(\d+)""").find(defaultUa)?.groupValues?.get(1) ?: "130"
        return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/$major.0.0.0 Safari/537.36"
    }

    /** Re-applies base/phone/custom CSS, viewport width and the download hooks (idempotent). */
    fun injectAll() {
        val config = JSONObject()
            .put("viewport", prefs.viewportWidth)
            .put("css", injectCss)
            .put("mobileCss", if (prefs.mobileLayout) mobileCss else "")
            .put("customCss", prefs.customCss)
        webView.evaluateJavascript("window.__zwConfig=$config;\n$injectJs", null)
    }

    fun applySettings() {
        webView.settings.textZoom = prefs.textZoom
        injectAll()
    }

    fun clearAllData() {
        val cookies = CookieManager.getInstance()
        WebStorage.getInstance().deleteAllData()
        webView.clearCache(true)
        webView.clearFormData()
        cookies.removeAllCookies {
            cookies.flush()
            clearHistoryOnLoad = true
            webView.loadUrl(HOME_URL)
        }
    }

    private inner class ZaloWebViewClient : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val uri = request.url
            return when (uri.scheme?.lowercase()) {
                "https" -> {
                    if (isZaloHost(uri.host) || !request.isForMainFrame) {
                        false
                    } else {
                        openExternal(uri)
                        true
                    }
                }
                "http" -> {
                    // Cleartext is blocked; upgrade Zalo links, hand everything else to the browser.
                    if (request.isForMainFrame) {
                        if (isZaloHost(uri.host)) {
                            view.loadUrl(uri.buildUpon().scheme("https").build().toString())
                        } else {
                            openExternal(uri)
                        }
                    }
                    true
                }
                "blob", "data", "about", "javascript" -> false
                else -> {
                    openExternal(uri)
                    true
                }
            }
        }

        override fun onPageFinished(view: WebView, url: String?) {
            if (clearHistoryOnLoad) {
                clearHistoryOnLoad = false
                view.clearHistory()
            }
            injectAll()
            CookieManager.getInstance().flush()
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            // The renderer died (e.g. killed for memory); rebuild everything with a fresh WebView.
            recreate()
            return true
        }
    }

    private inner class ZaloChromeClient : WebChromeClient() {
        override fun onShowFileChooser(
            view: WebView,
            callback: ValueCallback<Array<Uri>>,
            params: FileChooserParams
        ): Boolean {
            fileCallback?.onReceiveValue(null)
            fileCallback = callback

            val mimes = params.acceptTypes
                .flatMap { it.split(',') }
                .map { it.trim().lowercase() }
                .filter { it.isNotEmpty() }
                .mapNotNull { if (it.startsWith(".")) MimeTypeMap.getSingleton().getMimeTypeFromExtension(it.substring(1)) else it }
                .distinct()

            val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                when {
                    mimes.isEmpty() || "*/*" in mimes -> type = "*/*"
                    mimes.size == 1 -> type = mimes[0]
                    else -> {
                        type = "*/*"
                        putExtra(Intent.EXTRA_MIME_TYPES, mimes.toTypedArray())
                    }
                }
                putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.mode == FileChooserParams.MODE_OPEN_MULTIPLE)
            }

            try {
                startActivityForResult(Intent.createChooser(intent, null), REQ_FILE_CHOOSER)
            } catch (e: ActivityNotFoundException) {
                fileCallback = null
                callback.onReceiveValue(null)
                toast("Không tìm thấy ứng dụng chọn file")
            }
            return true
        }

        override fun onPermissionRequest(request: PermissionRequest) {
            runOnUiThread { handlePermissionRequest(request) }
        }

        override fun onPermissionRequestCanceled(request: PermissionRequest) {
            if (pendingPermission == request) pendingPermission = null
        }

        // Avoids the grey "play" placeholder Chromium draws before a <video> has a frame.
        override fun getDefaultVideoPoster(): Bitmap =
            Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != REQ_FILE_CHOOSER) {
            super.onActivityResult(requestCode, resultCode, data)
            return
        }
        val callback = fileCallback ?: return
        fileCallback = null

        var uris: Array<Uri>? = null
        if (resultCode == RESULT_OK && data != null) {
            val clip = data.clipData
            val single = data.data
            uris = when {
                clip != null && clip.itemCount > 0 -> Array(clip.itemCount) { clip.getItemAt(it).uri }
                single != null -> arrayOf(single)
                else -> null
            }
        }
        callback.onReceiveValue(uris)
    }

    // ---------------------------------------------------------------- Calls (camera / mic)

    private fun androidPermissionFor(resource: String): String? = when (resource) {
        PermissionRequest.RESOURCE_VIDEO_CAPTURE -> Manifest.permission.CAMERA
        PermissionRequest.RESOURCE_AUDIO_CAPTURE -> Manifest.permission.RECORD_AUDIO
        else -> null
    }

    private fun handlePermissionRequest(request: PermissionRequest) {
        val origin = request.origin
        if (origin.scheme != "https" || !isZaloHost(origin.host)) {
            request.deny()
            return
        }
        val wanted = request.resources.filter { androidPermissionFor(it) != null }
        if (wanted.isEmpty()) {
            request.deny()
            return
        }
        val missing = wanted
            .mapNotNull { androidPermissionFor(it) }
            .filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
            .distinct()
        if (missing.isEmpty()) {
            request.grant(wanted.toTypedArray())
            return
        }
        pendingPermission?.deny()
        pendingPermission = request
        requestPermissions(missing.toTypedArray(), REQ_MEDIA_PERMISSIONS)
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        if (requestCode != REQ_MEDIA_PERMISSIONS) return
        val request = pendingPermission ?: return
        pendingPermission = null
        val granted = request.resources.filter { resource ->
            val perm = androidPermissionFor(resource)
            perm != null && checkSelfPermission(perm) == PackageManager.PERMISSION_GRANTED
        }
        if (granted.isEmpty()) {
            request.deny()
            toast("Cần quyền camera/micro để gọi")
        } else {
            request.grant(granted.toTypedArray())
        }
    }

    // ---------------------------------------------------------------- Back / insets

    private fun setupBackNavigation() {
        if (Build.VERSION.SDK_INT >= 33) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(
                OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                OnBackInvokedCallback { handleBack() }
            )
        }
    }

    private fun handleBack() {
        if (webView.canGoBack()) webView.goBack() else moveTaskToBack(true)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        handleBack()
    }

    /** targetSdk 35 forces edge-to-edge; pad the root by system bars + keyboard so input stays visible. */
    @Suppress("DEPRECATION")
    private fun setupEdgeToEdge(root: View) {
        if (Build.VERSION.SDK_INT >= 30) {
            window.setDecorFitsSystemWindows(false)
        } else {
            root.systemUiVisibility = View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or
                View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        }
        root.setOnApplyWindowInsetsListener { v, insets ->
            if (Build.VERSION.SDK_INT >= 30) {
                val bars = insets.getInsets(
                    WindowInsets.Type.systemBars() or WindowInsets.Type.ime() or WindowInsets.Type.displayCutout()
                )
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
                WindowInsets.CONSUMED
            } else {
                v.setPadding(
                    insets.systemWindowInsetLeft,
                    insets.systemWindowInsetTop,
                    insets.systemWindowInsetRight,
                    insets.systemWindowInsetBottom
                )
                insets.consumeSystemWindowInsets()
            }
        }
        root.requestApplyInsets()
    }

    // ---------------------------------------------------------------- Helpers

    fun openExternal(uri: Uri) {
        var fallback: String? = null
        try {
            val intent = if (uri.scheme.equals("intent", ignoreCase = true)) {
                Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME).apply {
                    fallback = getStringExtra("browser_fallback_url")
                    component = null
                    selector = null
                }
            } else {
                Intent(Intent.ACTION_VIEW, uri)
            }
            intent.addCategory(Intent.CATEGORY_BROWSABLE)
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            startActivity(intent)
        } catch (e: Exception) {
            val url = fallback
            if (url != null && url.startsWith("http")) {
                openExternal(Uri.parse(url))
            } else {
                toast("Không mở được liên kết")
            }
        }
    }

    fun toast(message: String) {
        runOnUiThread { Toast.makeText(this, message, Toast.LENGTH_SHORT).show() }
    }

    private fun readAsset(name: String): String =
        assets.open(name).bufferedReader().use { it.readText() }
}
