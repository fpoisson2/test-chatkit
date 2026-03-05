package com.edxo.voice

import android.os.Bundle
import android.view.Gravity
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

/**
 * Simple activity to enter/paste the JWT auth token on the watch.
 * Accessible via long-press on the status text in MainActivity,
 * or launched from the app settings.
 */
class TokenSetupActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(16, 16, 16, 16)
            setBackgroundColor(0xFF000000.toInt())
        }

        val label = TextView(this).apply {
            text = "Auth Token"
            setTextColor(0xFFFFFFFF.toInt())
            textSize = 14f
            gravity = Gravity.CENTER
        }
        layout.addView(label)

        val input = EditText(this).apply {
            hint = "Paste JWT token"
            setTextColor(0xFFFFFFFF.toInt())
            setHintTextColor(0xFF888888.toInt())
            textSize = 10f
            maxLines = 3
            imeOptions = EditorInfo.IME_ACTION_DONE
            inputType = android.text.InputType.TYPE_CLASS_TEXT
        }
        layout.addView(input, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = 8 })

        // Load existing token
        val prefs = getSharedPreferences("edxo_voice", MODE_PRIVATE)
        val existing = prefs.getString("auth_token", "")
        if (!existing.isNullOrEmpty()) {
            input.setText(existing)
        }

        val saveBtn = Button(this).apply {
            text = "Save"
            setOnClickListener {
                val token = input.text.toString().trim()
                if (token.isEmpty()) {
                    Toast.makeText(this@TokenSetupActivity, "Token cannot be empty", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }
                prefs.edit().putString("auth_token", token).apply()
                Toast.makeText(this@TokenSetupActivity, "Token saved", Toast.LENGTH_SHORT).show()
                finish()
            }
        }
        layout.addView(saveBtn, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = 8 })

        setContentView(layout)
    }
}
