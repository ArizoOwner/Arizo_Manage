package com.arizo.manage

import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.WindowManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import androidx.core.view.WindowCompat
import com.arizo.manage.plugins.ArizoSecurityPlugin
import com.arizo.manage.plugins.ArizoSqlCipherPlugin
import com.getcapacitor.Bridge
import com.getcapacitor.BridgeActivity
import com.getcapacitor.BridgeWebViewClient
import java.io.ByteArrayInputStream

/**
 * - FLAG_SECURE on by default (screenshots, screen recording and the Recents thumbnail are blank).
 * - WebView network firewall: every request whose origin is not the app's own https://localhost is
 *   answered locally with 403 before it can reach the network. Navigation away from the app is refused.
 * - Edge-to-edge obsidian system bars.
 */
class MainActivity : BridgeActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(ArizoSecurityPlugin::class.java)
        registerPlugin(ArizoSqlCipherPlugin::class.java)
        super.onCreate(savedInstanceState)
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        @Suppress("DEPRECATION")
        window.statusBarColor = Color.TRANSPARENT
        @Suppress("DEPRECATION")
        window.navigationBarColor = Color.parseColor("#06080D")
        bridge.webView.setBackgroundColor(Color.parseColor("#06080D"))
        bridge.setWebViewClient(FirewallWebViewClient(bridge))
        bridge.webView.settings.apply {
            allowFileAccess = false
            allowContentAccess = false
            @Suppress("DEPRECATION")
            allowFileAccessFromFileURLs = false
            @Suppress("DEPRECATION")
            allowUniversalAccessFromFileURLs = false
            setGeolocationEnabled(false)
            @Suppress("DEPRECATION")
            saveFormData = false
        }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
    }

    override fun onPause() {
        super.onPause()
        // Lock signal for the web layer: the JS AutoLockManager shows the curtain and starts its timer.
        bridge?.triggerWindowJSEvent("arizoNativePause")
    }

    /** Called by ArizoSecurityPlugin for the user's temporary 2-minute screenshot allowance. */
    fun setSecureFlag(secure: Boolean) = runOnUiThread {
        if (secure) window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }

    private class FirewallWebViewClient(bridge: Bridge) : BridgeWebViewClient(bridge) {
        private val appOrigin: Uri = Uri.parse(bridge.localUrl)

        private fun isLocal(url: Uri): Boolean = when (url.scheme) {
            "data", "blob", "about" -> true
            appOrigin.scheme -> url.host == appOrigin.host && url.port == appOrigin.port
            else -> false
        }

        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            if (!isLocal(request.url)) return blocked()
            return super.shouldInterceptRequest(view, request)
        }

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            // true = handled (by refusing). The vault never opens external apps or browsers.
            if (!isLocal(request.url)) return true
            return super.shouldOverrideUrlLoading(view, request)
        }

        private fun blocked() =
            WebResourceResponse("text/plain", "utf-8", 403, "Blocked by Arizo firewall", emptyMap(), ByteArrayInputStream(ByteArray(0)))
    }
}
