# WebView looks up @JavascriptInterface methods by name and annotation at runtime.
-keepattributes RuntimeVisibleAnnotations

-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

-keep class vn.dangtq.zaloweb.Downloads$Bridge {
    @android.webkit.JavascriptInterface <methods>;
}
