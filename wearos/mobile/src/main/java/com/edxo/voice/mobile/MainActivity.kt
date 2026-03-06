package com.edxo.voice.mobile

import android.content.Intent
import android.os.Bundle
import android.util.Log
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.floatingactionbutton.FloatingActionButton

class MainActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "EDxoMobile"
    }

    private lateinit var webView: WebView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val prefs = getSharedPreferences("edxo_voice", MODE_PRIVATE)

        // If not logged in, redirect to login
        if (prefs.getString("auth_token", null).isNullOrEmpty()) {
            startActivity(Intent(this, LoginActivity::class.java))
            finish()
            return
        }

        val platformUrl = prefs.getString("server_base_url", null)
        if (platformUrl.isNullOrEmpty()) {
            startActivity(Intent(this, LoginActivity::class.java))
            finish()
            return
        }

        val root = FrameLayout(this)

        // WebView
        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.userAgentString = settings.userAgentString + " EDxoMobile/1.0"

            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = false

                override fun onPageFinished(view: WebView, url: String) {
                    super.onPageFinished(view, url)
                    injectTokenIntoPage()
                }
            }
            webChromeClient = WebChromeClient()

            addJavascriptInterface(TokenBridge(), "EdxoNative")
        }
        root.addView(webView, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ))

        // Voice FAB
        val fab = FloatingActionButton(this).apply {
            setImageResource(android.R.drawable.ic_btn_speak_now)
            contentDescription = "Assistant vocal"
            setOnClickListener { openVoiceAssistant() }
        }
        val fabParams = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply {
            gravity = android.view.Gravity.BOTTOM or android.view.Gravity.END
            marginEnd = (16 * resources.displayMetrics.density).toInt()
            bottomMargin = (16 * resources.displayMetrics.density).toInt()
        }
        root.addView(fab, fabParams)

        setContentView(root)

        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)

        webView.loadUrl(platformUrl)
    }

    /**
     * Inject the native auth token into the WebView's localStorage
     * so the web app is automatically logged in.
     */
    private fun injectTokenIntoPage() {
        val token = getSharedPreferences("edxo_voice", MODE_PRIVATE)
            .getString("auth_token", null) ?: return

        webView.evaluateJavascript("""
            (function() {
                var existing = localStorage.getItem('chatkit:auth:token');
                if (!existing || existing !== '$token') {
                    localStorage.setItem('chatkit:auth:token', '$token');
                    // Reload to pick up the token
                    if (!existing) location.reload();
                }
            })();
        """.trimIndent(), null)
    }

    private fun openVoiceAssistant() {
        startActivity(Intent(this, VoiceActivity::class.java))
    }

    fun logout() {
        getSharedPreferences("edxo_voice", MODE_PRIVATE).edit()
            .remove("auth_token")
            .apply()
        startActivity(Intent(this, LoginActivity::class.java))
        finish()
    }

    inner class TokenBridge {
        @JavascriptInterface
        fun onTokenReceived(token: String) {
            Log.i(TAG, "Token updated from WebView")
            val prefs = getSharedPreferences("edxo_voice", MODE_PRIVATE)
            val oldToken = prefs.getString("auth_token", null)
            prefs.edit().putString("auth_token", token).apply()

            if (token != oldToken) {
                val wsUrl = prefs.getString("server_url", null)
                WearSyncHelper.pushConfigToWatch(this@MainActivity, token = token, serverUrl = wsUrl)
            }
        }
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }
}
