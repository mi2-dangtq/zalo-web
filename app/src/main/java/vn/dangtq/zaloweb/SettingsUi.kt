package vn.dangtq.zaloweb

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.text.InputType
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import kotlin.math.hypot

class Prefs(context: Context) {
    private val sp = context.getSharedPreferences("zaloweb", Context.MODE_PRIVATE)

    /** Layout width in CSS px injected via meta viewport; 0 = keep Zalo's own width=device-width. */
    var viewportWidth: Int
        get() = sp.getInt("viewport_width", 0)
        set(value) = sp.edit().putInt("viewport_width", value).apply()

    /** Inject assets/zalo-mobile.css (Zalo-specific phone tweaks). */
    var mobileLayout: Boolean
        get() = sp.getBoolean("mobile_layout", true)
        set(value) = sp.edit().putBoolean("mobile_layout", value).apply()

    var textZoom: Int
        get() = sp.getInt("text_zoom", 100)
        set(value) = sp.edit().putInt("text_zoom", value).apply()

    /** Zalo's text in the phone's own font ([SystemFont]) instead of Zalo's Segoe UI. */
    var systemFont: Boolean
        get() = sp.getBoolean("system_font", true)
        set(value) = sp.edit().putBoolean("system_font", value).apply()

    var customCss: String
        get() = sp.getString("custom_css", "") ?: ""
        set(value) = sp.edit().putString("custom_css", value).apply()

    /** Floating button position as a fraction (0..1) of the available area; negative = default. */
    var fabX: Float
        get() = sp.getFloat("fab_x", -1f)
        set(value) = sp.edit().putFloat("fab_x", value).apply()

    var fabY: Float
        get() = sp.getFloat("fab_y", -1f)
        set(value) = sp.edit().putFloat("fab_y", value).apply()

    /** Zalo's last page background (light or dark theme), reused for the splash on the next launch. */
    var pageColor: Int
        get() = sp.getInt("page_color", Color.WHITE)
        set(value) = sp.edit().putInt("page_color", value).apply()
}

class SettingsUi(private val activity: MainActivity, private val root: FrameLayout) {

    companion object {
        private const val IDLE_ALPHA = 0.35f
        private const val ACTIVE_ALPHA = 0.85f
        private const val DEFAULT_FAB_Y = 0.4f
        private const val TOP_GUARD_DP = 64
        private const val BOTTOM_GUARD_DP = 72
        private val WIDTHS = intArrayOf(0, 480, 600, 800, 1000, 1200)
        private val ZOOMS = intArrayOf(80, 90, 100, 110, 125, 150)
        private val DIALOG_THEME = android.R.style.Theme_Material_Light_Dialog_Alert
    }

    private val prefs get() = activity.prefs
    private val density = activity.resources.displayMetrics.density
    private lateinit var fab: ImageView

    private fun dp(value: Int) = (value * density).toInt()

    fun attach() {
        val size = dp(40)
        fab = ImageView(activity).apply {
            setImageResource(R.drawable.ic_fab)
            scaleType = ImageView.ScaleType.CENTER
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(activity.getColor(R.color.brand))
            }
            alpha = IDLE_ALPHA
            elevation = dp(4).toFloat()
            contentDescription = activity.getString(R.string.settings)
        }
        root.addView(fab, FrameLayout.LayoutParams(size, size, Gravity.TOP or Gravity.START))
        root.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> placeFab() }
        makeDraggable()
        fab.setOnClickListener { showMenu() }
    }

    // ---------------------------------------------------------------- Floating button

    // Keep the button off the header (top) and off the composer / tab bar / Send button (bottom),
    // which also shrink into the keyboard's padding.
    private fun minY() = dp(TOP_GUARD_DP).toFloat()
    private fun maxX() = (root.width - root.paddingLeft - root.paddingRight - fab.width).coerceAtLeast(0).toFloat()
    private fun maxY() = (root.height - root.paddingTop - root.paddingBottom - fab.height - dp(BOTTOM_GUARD_DP))
        .toFloat().coerceAtLeast(minY())

    private fun yForFraction(f: Float) = minY() + f.coerceIn(0f, 1f) * (maxY() - minY())

    /** Off screen while Zalo's photo viewer is up, where it would sit on the photo. */
    fun setFabHidden(hidden: Boolean) {
        fab.visibility = if (hidden) View.GONE else View.VISIBLE
    }

    private fun fractionForY(y: Float): Float {
        val range = maxY() - minY()
        return if (range > 0f) ((y - minY()) / range).coerceIn(0f, 1f) else DEFAULT_FAB_Y
    }

    private fun placeFab() {
        val fx = prefs.fabX.takeIf { it >= 0f } ?: 1f
        val fy = prefs.fabY.takeIf { it >= 0f } ?: DEFAULT_FAB_Y
        fab.translationX = fx.coerceIn(0f, 1f) * maxX()
        fab.translationY = yForFraction(fy)
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun makeDraggable() {
        val slop = ViewConfiguration.get(activity).scaledTouchSlop
        var downX = 0f
        var downY = 0f
        var startX = 0f
        var startY = 0f
        var dragging = false

        fab.setOnTouchListener { v, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downX = e.rawX
                    downY = e.rawY
                    startX = v.translationX
                    startY = v.translationY
                    dragging = false
                    v.alpha = ACTIVE_ALPHA
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = e.rawX - downX
                    val dy = e.rawY - downY
                    if (!dragging && hypot(dx, dy) > slop) dragging = true
                    if (dragging) {
                        v.translationX = (startX + dx).coerceIn(0f, maxX())
                        v.translationY = (startY + dy).coerceIn(minY(), maxY())
                    }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    v.alpha = IDLE_ALPHA
                    if (dragging) {
                        val mx = maxX()
                        prefs.fabX = if (mx > 0f) v.translationX / mx else 1f
                        prefs.fabY = fractionForY(v.translationY)
                    } else {
                        v.performClick()
                    }
                    true
                }
                MotionEvent.ACTION_CANCEL -> {
                    v.alpha = IDLE_ALPHA
                    true
                }
                else -> false
            }
        }
    }

    // ---------------------------------------------------------------- Menu

    private fun widthLabel(width: Int) = if (width == 0) "Tự động" else "$width px"

    private fun showMenu() {
        val items = arrayOf(
            "Tải lại trang",
            "Giao diện điện thoại: ${if (prefs.mobileLayout) "Bật" else "Tắt"}",
            "Độ rộng hiển thị: ${widthLabel(prefs.viewportWidth)}",
            "Cỡ chữ: ${prefs.textZoom}%",
            "Font của máy: ${if (prefs.systemFont) "Bật" else "Tắt"}",
            "CSS tùy chỉnh",
            "Đăng xuất / xóa dữ liệu"
        )
        AlertDialog.Builder(activity, DIALOG_THEME)
            .setTitle(R.string.app_name)
            .setItems(items) { _, which ->
                when (which) {
                    0 -> activity.webView.reload()
                    1 -> toggleMobileLayout()
                    2 -> chooseWidth()
                    3 -> chooseTextZoom()
                    4 -> toggleSystemFont()
                    5 -> editCustomCss()
                    6 -> confirmClearData()
                }
            }
            .setNegativeButton("Đóng", null)
            .show()
    }

    private fun toggleMobileLayout() {
        prefs.mobileLayout = !prefs.mobileLayout
        activity.applySettings()
        activity.toast(if (prefs.mobileLayout) "Đã bật giao diện điện thoại" else "Đã tắt giao diện điện thoại")
    }

    private fun toggleSystemFont() {
        prefs.systemFont = !prefs.systemFont
        activity.applySettings()
        activity.toast(if (prefs.systemFont) "Zalo dùng font của máy" else "Zalo dùng font riêng của Zalo")
    }

    private fun chooseWidth() {
        val labels = WIDTHS.map {
            if (it == 0) "${widthLabel(it)} — theo màn hình (khuyên dùng)" else widthLabel(it)
        }.toTypedArray()
        AlertDialog.Builder(activity, DIALOG_THEME)
            .setTitle("Độ rộng hiển thị")
            .setSingleChoiceItems(labels, WIDTHS.indexOf(prefs.viewportWidth)) { dialog, which ->
                prefs.viewportWidth = WIDTHS[which]
                activity.applySettings()
                dialog.dismiss()
            }
            .setNegativeButton("Hủy", null)
            .show()
    }

    private fun chooseTextZoom() {
        val labels = ZOOMS.map { "$it%" }.toTypedArray()
        AlertDialog.Builder(activity, DIALOG_THEME)
            .setTitle("Cỡ chữ")
            .setSingleChoiceItems(labels, ZOOMS.indexOf(prefs.textZoom)) { dialog, which ->
                prefs.textZoom = ZOOMS[which]
                activity.applySettings()
                dialog.dismiss()
            }
            .setNegativeButton("Hủy", null)
            .show()
    }

    private fun editCustomCss() {
        val pad = dp(20)
        val hint = TextView(activity).apply {
            text = "CSS được chèn vào cuối trang (dùng !important nếu cần). " +
                "Mở chrome://inspect trên PC để xem DOM của Zalo."
            textSize = 13f
        }
        val input = EditText(activity).apply {
            setText(prefs.customCss)
            inputType = InputType.TYPE_CLASS_TEXT or
                InputType.TYPE_TEXT_FLAG_MULTI_LINE or
                InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            setSingleLine(false)
            minLines = 6
            maxLines = 14
            gravity = Gravity.TOP or Gravity.START
            typeface = Typeface.MONOSPACE
            textSize = 13f
            setHorizontallyScrolling(false)
        }
        val container = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, dp(8), pad, 0)
            addView(hint)
            addView(input, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        }

        val dialog = AlertDialog.Builder(activity, DIALOG_THEME)
            .setTitle("CSS tùy chỉnh")
            .setView(container)
            .setPositiveButton("Áp dụng") { _, _ ->
                prefs.customCss = input.text.toString()
                activity.applySettings()
            }
            .setNeutralButton("Xóa hết") { _, _ ->
                prefs.customCss = ""
                activity.applySettings()
            }
            .setNegativeButton("Hủy", null)
            .create()
        dialog.window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        dialog.show()
    }

    private fun confirmClearData() {
        AlertDialog.Builder(activity, DIALOG_THEME)
            .setTitle("Đăng xuất / xóa dữ liệu")
            .setMessage("Xóa cookie, cache và dữ liệu trang. Bạn sẽ phải đăng nhập Zalo lại (quét mã QR).")
            .setPositiveButton("Xóa") { _, _ -> activity.clearAllData() }
            .setNegativeButton("Hủy", null)
            .show()
    }
}
