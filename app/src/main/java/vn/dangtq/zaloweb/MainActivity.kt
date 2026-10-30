package vn.dangtq.zaloweb

import android.Manifest
import android.annotation.SuppressLint
import android.annotation.TargetApi
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorFilter
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.drawable.Drawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsAnimation
import android.view.WindowInsetsController
import android.webkit.CookieManager
import android.webkit.MimeTypeMap
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.Toast
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher
import org.json.JSONObject

class MainActivity : Activity() {

    companion object {
        const val HOME_URL = "https://chat.zalo.me/"
        private const val CHAT_HOST = "chat.zalo.me"
        private const val LOGIN_HOST = "id.zalo.me"
        private const val REQ_FILE_CHOOSER = 1001
        private const val REQ_MEDIA_PERMISSIONS = 1002
        private const val MAX_RENDERER_RESTARTS = 3
        private const val RENDERER_RESTART_WINDOW_MS = 60_000L
        private const val RETRY_FIRST_MS = 3_000L
        private const val RETRY_MAX_MS = 30_000L

        private val RETRYABLE_ERRORS = setOf(
            WebViewClient.ERROR_HOST_LOOKUP, WebViewClient.ERROR_CONNECT, WebViewClient.ERROR_TIMEOUT
        )

        // Per process, not per Activity: a renderer restart recreates the Activity.
        private val rendererRestarts = ArrayDeque<Long>()

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
    private lateinit var zaloCss: ZaloCss
    private val systemFont = SystemFont()
    // The font version the page was last given ("" = none, null = not injected yet).
    private var injectedFont: String? = null
    private var injectJs = ""
    private var injectCss = ""
    private var mobileCss = ""
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    // Only one runtime-permission dialog can be up at a time; requests arriving meanwhile wait here.
    private val pendingPermissions = mutableListOf<PermissionRequest>()
    private var permissionDialogOpen = false
    private var clearHistoryOnLoad = false
    private var resumed = false
    private var recreatePending = false
    // The page itself failed to load (offline at launch, DNS): retried while the app is on screen.
    private var loadFailed = false
    private var retryDelayMs = RETRY_FIRST_MS
    private val retryLoad = Runnable { if (loadFailed && resumed) webView.reload() }
    private var splash: View? = null
    private lateinit var rootLayout: FrameLayout
    private lateinit var rootBackground: RootBackground
    private lateinit var settingsUi: SettingsUi
    // Zalo's photo viewer is up (inject.js): black system bars and no floating button meanwhile.
    private var viewerOpen = false

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
        rootLayout = root
        rootBackground = RootBackground(prefs.pageColor)
        root.background = rootBackground
        webView = WebView(this)
        root.addView(
            webView,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        )
        setContentView(root)
        setupEdgeToEdge(root)
        applySystemBarStyle()

        downloads = Downloads(this)
        configureWebView()
        settingsUi = SettingsUi(this, root).also { it.attach() }
        showSplash(root)
        setupBackNavigation()

        webView.loadUrl(HOME_URL)
    }

    override fun onResume() {
        super.onResume()
        resumed = true
        if (recreatePending) {
            recreatePending = false
            recreate()
        } else if (loadFailed) {
            webView.removeCallbacks(retryLoad)
            webView.reload()
        } else if (injectedFont != null && injectedFont != currentFontVersion()) {
            injectAll() // a new font was chosen in Themes while we were away
        }
    }

    override fun onPause() {
        super.onPause()
        resumed = false
        CookieManager.getInstance().flush()
    }

    override fun onDestroy() {
        webView.removeCallbacks(retryLoad)
        downloads.abortAll()
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
        zaloCss = ZaloCss(cacheDir, s.userAgentString)

        val cookies = CookieManager.getInstance()
        cookies.setAcceptCookie(true)
        cookies.setAcceptThirdPartyCookies(webView, true)

        // No edge glow/stretch: scrolling should stop dead like a native list.
        webView.overScrollMode = View.OVER_SCROLL_NEVER
        // Keep the renderer from being killed first under memory pressure while visible.
        webView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, true)

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
        val font = if (prefs.systemFont) systemFont.current() else null
        injectedFont = font?.version ?: ""
        val config = JSONObject()
            .put("viewport", prefs.viewportWidth)
            .put("css", injectCss)
            .put("mobileCss", if (prefs.mobileLayout) mobileCss else "")
            .put("customCss", prefs.customCss)
            .put("systemFont", font?.url ?: "")
        webView.evaluateJavascript("window.__zwConfig=$config;\nwindow.__zwKeyboardOpen=$keyboardOpen;\n$injectJs", null)
    }

    private fun currentFontVersion(): String =
        if (prefs.systemFont) systemFont.current()?.version ?: "" else ""

    /** Whether the keyboard is shown, as the window insets say; mirrored to the page as __zwKeyboardOpen. */
    private var keyboardOpen = false

    private fun setKeyboardOpen(open: Boolean) {
        if (open == keyboardOpen) return
        keyboardOpen = open
        if (::webView.isInitialized) webView.evaluateJavascript("window.__zwKeyboardOpen=$open", null)
    }

    fun applySettings() {
        webView.settings.textZoom = prefs.textZoom
        applySystemBarStyle()
        injectAll()
    }

    /** inject.js reports Zalo's page background whenever its light/dark theme changes. */
    fun setPageColor(css: String) {
        // parseColor throws StringIndexOutOfBounds (not IllegalArgument) for "", and this runs on
        // the UI thread, where an uncaught exception would crash the app.
        val color = try {
            Color.parseColor(css)
        } catch (e: RuntimeException) {
            return
        }
        if (color == prefs.pageColor) return
        prefs.pageColor = color
        applySystemBarStyle()
    }

    /** inject.js reports Zalo's photo viewer opening and closing (phone skin only). */
    fun setViewerOpen(open: Boolean) {
        if (open == viewerOpen) return
        viewerOpen = open
        applySystemBarStyle()
        settingsUi.setFabHidden(open)
    }

    /**
     * Bar areas follow the page: its background (light or dark theme) behind the navigation bar,
     * and with the phone skin's blue headers, a blue status bar band with white icons. Both are
     * black, with white icons, while the photo viewer is up.
     */
    @Suppress("DEPRECATION")
    private fun applySystemBarStyle() {
        val blue = prefs.mobileLayout
        val base = if (viewerOpen) Color.BLACK else prefs.pageColor
        val darkPage = Color.luminance(base) < 0.5f
        rootBackground.baseColor = base
        rootBackground.bandColor = when {
            viewerOpen -> Color.BLACK
            blue -> getColor(R.color.skin_header)
            else -> Color.TRANSPARENT
        }
        val lightStatus = !blue && !darkPage
        val lightNav = !darkPage
        if (Build.VERSION.SDK_INT >= 30) {
            window.insetsController?.setSystemBarsAppearance(
                (if (lightStatus) WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS else 0) or
                    (if (lightNav) WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS else 0),
                WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
                    WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
            )
        } else {
            var flags = rootLayout.systemUiVisibility and
                (View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR).inv()
            if (lightStatus) flags = flags or View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
            if (lightNav) flags = flags or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
            rootLayout.systemUiVisibility = flags
        }
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
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
            systemFont.intercept(request) ?: zaloCss.intercept(request)

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val uri = request.url
            return when (uri.scheme?.lowercase()) {
                "https" -> when {
                    !request.isForMainFrame -> false
                    !isZaloHost(uri.host) -> {
                        openExternal(uri)
                        true
                    }
                    // From the chat app, another Zalo page (group invite, profile link, file on the
                    // CDN) would unload chat.zalo.me and lose its state; show it in the browser.
                    // The login pages still load in-app.
                    hostOf(view.url) == CHAT_HOST && uri.host != CHAT_HOST && uri.host != LOGIN_HOST -> {
                        openExternal(uri)
                        true
                    }
                    else -> false
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
                    // tel:, intent:, market:… open other apps; an embedded frame only gets to on a tap.
                    if (request.isForMainFrame || request.hasGesture()) openExternal(uri)
                    true
                }
            }
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            loadFailed = false
            setViewerOpen(false) // a new page has no viewer up
        }

        override fun onPageFinished(view: WebView, url: String?) {
            if (clearHistoryOnLoad) {
                clearHistoryOnLoad = false
                view.clearHistory()
            }
            if (!loadFailed) retryDelayMs = RETRY_FIRST_MS
            injectAll()
            CookieManager.getInstance().flush()
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (!request.isForMainFrame) return
            // Show WebView's error page instead of a splash that never goes away.
            hideSplash()
            // No network yet (e.g. the app opened as the phone woke up): WebView's error page has no
            // retry button, so try again by itself, backing off, while the app is on screen.
            if (error.errorCode in RETRYABLE_ERRORS && isZaloHost(request.url.host)) {
                loadFailed = true
                view.removeCallbacks(retryLoad)
                if (resumed) view.postDelayed(retryLoad, retryDelayMs)
                retryDelayMs = (retryDelayMs * 2).coerceAtMost(RETRY_MAX_MS)
            }
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            // The renderer died (e.g. killed for memory); rebuild everything with a fresh WebView,
            // but not while in the background and not in a crash loop.
            (view.parent as? ViewGroup)?.removeView(view)
            val now = System.currentTimeMillis()
            while (rendererRestarts.isNotEmpty() && now - rendererRestarts.first() > RENDERER_RESTART_WINDOW_MS) {
                rendererRestarts.removeFirst()
            }
            if (rendererRestarts.size >= MAX_RENDERER_RESTARTS) {
                toast("Zalo Web gặp lỗi liên tục, hãy mở lại app")
                finish()
                return true
            }
            rendererRestarts.addLast(now)
            if (resumed) recreate() else recreatePending = true
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

            // While the picker (often a heavy gallery or camera app) covers us, keep the renderer from
            // being the first thing killed for memory: the picked files go to the page that asked.
            view.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)
            try {
                startActivityForResult(Intent.createChooser(intent, null), REQ_FILE_CHOOSER)
            } catch (e: ActivityNotFoundException) {
                view.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, true)
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
            runOnUiThread { pendingPermissions.remove(request) }
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
        webView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, true)
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
        if (request.resources.none { androidPermissionFor(it) != null }) {
            request.deny()
            return
        }
        if (missingPermissions(request).isEmpty()) {
            settlePermission(request)
            return
        }
        pendingPermissions += request
        askPendingPermissions()
    }

    private fun missingPermissions(request: PermissionRequest): List<String> =
        request.resources
            .mapNotNull { androidPermissionFor(it) }
            .filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
            .distinct()

    /** Grants whatever the user has allowed so far; denies the request if that is nothing. */
    private fun settlePermission(request: PermissionRequest): Boolean {
        val granted = request.resources.filter { resource ->
            val perm = androidPermissionFor(resource)
            perm != null && checkSelfPermission(perm) == PackageManager.PERMISSION_GRANTED
        }
        return if (granted.isEmpty()) {
            request.deny()
            false
        } else {
            request.grant(granted.toTypedArray())
            true
        }
    }

    private fun askPendingPermissions() {
        if (permissionDialogOpen) return
        val missing = pendingPermissions.flatMap { missingPermissions(it) }.distinct()
        if (missing.isEmpty()) {
            pendingPermissions.toList().forEach { settlePermission(it) }
            pendingPermissions.clear()
            return
        }
        permissionDialogOpen = true
        requestPermissions(missing.toTypedArray(), REQ_MEDIA_PERMISSIONS)
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        if (requestCode != REQ_MEDIA_PERMISSIONS) return
        permissionDialogOpen = false
        val asked = permissions.toSet()
        val waiting = pendingPermissions.toList()
        pendingPermissions.clear()
        var anyDenied = false
        for (request in waiting) {
            // Needs a permission that was not in this dialog (it arrived while it was open): ask again.
            if (asked.isNotEmpty() && missingPermissions(request).any { it !in asked }) {
                pendingPermissions += request
            } else if (!settlePermission(request)) {
                anyDenied = true
            }
        }
        if (anyDenied) toast("Cần quyền camera/micro để gọi")
        if (pendingPermissions.isNotEmpty()) askPendingPermissions()
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

    /**
     * Popup -> search -> info panel -> open chat are closed inside Zalo (inject.js). On the chat
     * app and the login page Back sends the app to the background (their history only holds the
     * chat <-> login redirects, so going back would just reload); on other pages it goes back first.
     */
    private fun handleBack() {
        webView.evaluateJavascript("window.__zwBack ? window.__zwBack() : false") { handled ->
            if (handled == "true") return@evaluateJavascript
            val host = hostOf(webView.url)
            if (host != CHAT_HOST && host != LOGIN_HOST && webView.canGoBack()) {
                webView.goBack()
            } else {
                moveTaskToBack(true)
            }
        }
    }

    private fun hostOf(url: String?): String? = url?.let { Uri.parse(it).host?.lowercase() }

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
                setKeyboardOpen(insets.isVisible(WindowInsets.Type.ime()))
                val ime = if (deferKeyboardResize) 0 else WindowInsets.Type.ime()
                val bars = insets.getInsets(WindowInsets.Type.systemBars() or ime or WindowInsets.Type.displayCutout())
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
                rootBackground.bandHeight = bars.top
                WindowInsets.CONSUMED
            } else {
                v.setPadding(
                    insets.systemWindowInsetLeft,
                    insets.systemWindowInsetTop,
                    insets.systemWindowInsetRight,
                    insets.systemWindowInsetBottom
                )
                rootBackground.bandHeight = insets.systemWindowInsetTop
                insets.consumeSystemWindowInsets()
            }
        }
        if (Build.VERSION.SDK_INT >= 30) root.setWindowInsetsAnimationCallback(KeyboardAnimation(root))
        root.requestApplyInsets()
    }

    /** A keyboard-opening animation is running: the WebView keeps its height until it ends. */
    private var deferKeyboardResize = false

    /**
     * Keyboard and chat move together (phone skin). Android lays the window out for the keyboard's
     * end state at once, so the WebView used to jump while the keyboard was still sliding in.
     *  - Opening: the WebView keeps its full height until the keyboard is up, while the page slides
     *    the chat (messages + composer) up with it; then the WebView shrinks and the page drops its
     *    slide in that same frame.
     *  - Closing: the WebView grows at once as before; the page slides the chat down from where it
     *    was.
     * The page (inject.js __zwKeyboard) animates on the compositor with the keyboard's own curve
     * and duration, so it stays smooth while Zalo's JS is busy.
     */
    @TargetApi(30)
    private inner class KeyboardAnimation(private val root: View) :
        WindowInsetsAnimation.Callback(WindowInsetsAnimation.Callback.DISPATCH_MODE_STOP) {
        private var opening = false

        private fun isKeyboard(animation: WindowInsetsAnimation) =
            prefs.mobileLayout && animation.typeMask and WindowInsets.Type.ime() != 0

        override fun onPrepare(animation: WindowInsetsAnimation) {
            if (!isKeyboard(animation)) return
            opening = root.rootWindowInsets?.isVisible(WindowInsets.Type.ime()) != true
            if (opening) deferKeyboardResize = true
        }

        override fun onStart(
            animation: WindowInsetsAnimation,
            bounds: WindowInsetsAnimation.Bounds
        ): WindowInsetsAnimation.Bounds {
            if (isKeyboard(animation)) {
                val bars = root.rootWindowInsets?.getInsets(WindowInsets.Type.systemBars())?.bottom ?: 0
                val lift = (bounds.upperBound.bottom - bars).coerceAtLeast(0)
                webView.evaluateJavascript(
                    "window.__zwKeyboard&&__zwKeyboard($opening,$lift,${animation.durationMillis}," +
                        "${System.currentTimeMillis()},${webView.height})",
                    null
                )
            }
            return bounds
        }

        override fun onProgress(insets: WindowInsets, running: MutableList<WindowInsetsAnimation>) = insets

        override fun onEnd(animation: WindowInsetsAnimation) {
            if (deferKeyboardResize && animation.typeMask and WindowInsets.Type.ime() != 0) {
                deferKeyboardResize = false
                root.requestApplyInsets()
            }
        }
    }

    // ---------------------------------------------------------------- Splash

    /** Covers the WebView (and Zalo's own loading screen) until inject.js reports the UI is ready. */
    private fun showSplash(root: FrameLayout) {
        val density = resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()

        val icon = ImageView(this).apply { setImageResource(R.mipmap.ic_launcher) }
        val progress = ProgressBar(this).apply {
            isIndeterminate = true
            indeterminateTintList = ColorStateList.valueOf(getColor(R.color.brand))
        }
        val view = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(prefs.pageColor)
            isClickable = true
            addView(icon, LinearLayout.LayoutParams(dp(96), dp(96)))
            addView(progress, LinearLayout.LayoutParams(dp(28), dp(28)).apply { topMargin = dp(40) })
        }
        root.addView(
            view,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        )
        splash = view
        root.postDelayed({ hideSplash() }, 15_000)
    }

    fun hideSplash() {
        val view = splash ?: return
        splash = null
        view.animate()
            .alpha(0f)
            .setDuration(200)
            .withEndAction { (view.parent as? ViewGroup)?.removeView(view) }
            .start()
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

/** Window background: the page colour plus an optional band behind the status bar. */
private class RootBackground(initialColor: Int) : Drawable() {
    private val paint = Paint()

    var baseColor = initialColor
        set(value) {
            if (field != value) {
                field = value
                invalidateSelf()
            }
        }

    var bandHeight = 0
        set(value) {
            if (field != value) {
                field = value
                invalidateSelf()
            }
        }

    var bandColor = Color.TRANSPARENT
        set(value) {
            if (field != value) {
                field = value
                invalidateSelf()
            }
        }

    override fun draw(canvas: Canvas) {
        canvas.drawColor(baseColor)
        if (bandHeight > 0 && Color.alpha(bandColor) != 0) {
            paint.color = bandColor
            canvas.drawRect(0f, 0f, bounds.width().toFloat(), bandHeight.toFloat(), paint)
        }
    }

    override fun setAlpha(alpha: Int) {}

    override fun setColorFilter(colorFilter: ColorFilter?) {}

    @Deprecated("Deprecated in Java")
    override fun getOpacity(): Int = PixelFormat.OPAQUE
}
