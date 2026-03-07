package com.edxo.voice.mobile

import android.content.Intent
import android.os.Bundle
import android.util.Log
import android.view.Gravity
import android.view.ViewGroup
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "EDxoMobile"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val prefs = getSharedPreferences("edxo_voice", MODE_PRIVATE)

        if (prefs.getString("auth_token", null).isNullOrEmpty()
            || prefs.getString("server_base_url", null).isNullOrEmpty()) {
            startActivity(Intent(this, LoginActivity::class.java))
            finish()
            return
        }

        val density = resources.displayMetrics.density

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(0xFF0D1117.toInt())
        }

        // Top spacer to push content down
        val topSpacer = android.view.View(this)
        root.addView(topSpacer, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f
        ))

        // App title
        val title = TextView(this).apply {
            text = "EDxo"
            setTextColor(0xFFFFFFFF.toInt())
            textSize = 32f
            gravity = Gravity.CENTER
        }
        root.addView(title, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        ))

        // Server info
        val serverUrl = prefs.getString("server_base_url", "") ?: ""
        val serverLabel = TextView(this).apply {
            text = serverUrl
            setTextColor(0xFF666666.toInt())
            textSize = 12f
            gravity = Gravity.CENTER
        }
        root.addView(serverLabel, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = (8 * density).toInt() })

        // Voice assistant button
        val voiceBtn = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setBackgroundColor(0xFF1A1A2E.toInt())
            setPadding((24 * density).toInt(), (16 * density).toInt(), (24 * density).toInt(), (16 * density).toInt())
            setOnClickListener { openVoiceAssistant() }
        }

        val voiceIcon = ImageButton(this).apply {
            setImageResource(android.R.drawable.ic_btn_speak_now)
            setBackgroundColor(0x00000000)
            setColorFilter(0xFF3B82F6.toInt())
            val p = (4 * density).toInt()
            setPadding(p, p, p, p)
        }
        voiceBtn.addView(voiceIcon, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT
        ))

        val voiceLabel = TextView(this).apply {
            text = "Assistant vocal"
            setTextColor(0xFFFFFFFF.toInt())
            textSize = 18f
            setPadding((12 * density).toInt(), 0, 0, 0)
        }
        voiceBtn.addView(voiceLabel, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT
        ))

        root.addView(voiceBtn, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply {
            topMargin = (48 * density).toInt()
            marginStart = (32 * density).toInt()
            marginEnd = (32 * density).toInt()
        })

        // Bottom spacer
        val bottomSpacer = android.view.View(this)
        root.addView(bottomSpacer, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f
        ))

        // Bottom bar
        val bottomBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(0xFF161B22.toInt())
            setPadding((12 * density).toInt(), (10 * density).toInt(), (12 * density).toInt(), (10 * density).toInt())
        }

        val appLabel = TextView(this).apply {
            text = "EDxo"
            setTextColor(0xFF8899BB.toInt())
            textSize = 14f
        }
        bottomBar.addView(appLabel, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))

        val logoutBtn = ImageButton(this).apply {
            setImageResource(android.R.drawable.ic_menu_revert)
            setBackgroundColor(0x00000000)
            setColorFilter(0xFF666666.toInt())
            contentDescription = "Deconnexion"
            val p = (8 * density).toInt()
            setPadding(p, p, p, p)
            setOnClickListener { logout() }
        }
        bottomBar.addView(logoutBtn, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT
        ))

        root.addView(bottomBar, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        ))

        setContentView(root)
    }

    private fun openVoiceAssistant() {
        startActivity(Intent(this, VoiceActivity::class.java))
    }

    private fun logout() {
        getSharedPreferences("edxo_voice", MODE_PRIVATE).edit()
            .remove("auth_token")
            .remove("server_base_url")
            .remove("server_url")
            .remove("workflow_id")
            .remove("workflow_name")
            .remove("saved_email")
            .apply()
        startActivity(Intent(this, LoginActivity::class.java))
        finish()
    }
}
