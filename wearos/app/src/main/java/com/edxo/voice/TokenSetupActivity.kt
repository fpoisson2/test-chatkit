package com.edxo.voice

import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import kotlin.concurrent.thread

class TokenSetupActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val scroll = ScrollView(this).apply {
            setBackgroundColor(0xFF000000.toInt())
        }

        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(24, 24, 24, 24)
        }

        val title = TextView(this).apply {
            text = "EDxo"
            setTextColor(0xFFFFFFFF.toInt())
            textSize = 16f
            gravity = Gravity.CENTER
        }
        layout.addView(title)

        val prefs = getSharedPreferences("edxo_voice", MODE_PRIVATE)

        // Server URL
        val urlInput = EditText(this).apply {
            hint = "https://..."
            setText(prefs.getString("server_base_url", ""))
            setTextColor(0xFFFFFFFF.toInt())
            setHintTextColor(0xFF888888.toInt())
            textSize = 11f
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            imeOptions = EditorInfo.IME_ACTION_NEXT
            maxLines = 1
        }
        layout.addView(urlInput, lp(topMargin = 12))

        // Email
        val emailInput = EditText(this).apply {
            hint = "Email"
            setText(prefs.getString("saved_email", ""))
            setTextColor(0xFFFFFFFF.toInt())
            setHintTextColor(0xFF888888.toInt())
            textSize = 12f
            inputType = InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
            imeOptions = EditorInfo.IME_ACTION_NEXT
            maxLines = 1
        }
        layout.addView(emailInput, lp(topMargin = 8))

        // Password
        val passwordInput = EditText(this).apply {
            hint = "Mot de passe"
            setTextColor(0xFFFFFFFF.toInt())
            setHintTextColor(0xFF888888.toInt())
            textSize = 12f
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            imeOptions = EditorInfo.IME_ACTION_DONE
            maxLines = 1
        }
        layout.addView(passwordInput, lp(topMargin = 8))

        val loginBtn = Button(this).apply {
            text = "Connexion"
            setOnClickListener {
                val serverUrl = urlInput.text.toString().trim().trimEnd('/')
                val email = emailInput.text.toString().trim()
                val password = passwordInput.text.toString()

                if (serverUrl.isEmpty()) {
                    Toast.makeText(this@TokenSetupActivity, "URL serveur requise", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }
                if (email.isEmpty() || password.isEmpty()) {
                    Toast.makeText(this@TokenSetupActivity, "Email et mot de passe requis", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }

                isEnabled = false
                text = "..."
                doLogin(serverUrl, email, password) { success, message ->
                    runOnUiThread {
                        isEnabled = true
                        text = "Connexion"
                        if (success) {
                            Toast.makeText(this@TokenSetupActivity, "Connecte!", Toast.LENGTH_SHORT).show()
                            finish()
                        } else {
                            Toast.makeText(this@TokenSetupActivity, message, Toast.LENGTH_SHORT).show()
                        }
                    }
                }
            }
        }
        layout.addView(loginBtn, lp(topMargin = 12))

        scroll.addView(layout)
        setContentView(scroll)
    }

    private fun lp(topMargin: Int = 0) = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT
    ).apply { this.topMargin = topMargin }

    private fun doLogin(serverUrl: String, email: String, password: String, callback: (Boolean, String) -> Unit) {
        thread {
            try {
                val body = JSONObject()
                    .put("email", email)
                    .put("password", password)
                    .toString()

                val request = Request.Builder()
                    .url("$serverUrl/api/voice-relay/auth")
                    .post(body.toRequestBody("application/json".toMediaType()))
                    .build()

                val response = OkHttpClient().newCall(request).execute()
                val respBody = response.body?.string() ?: ""

                if (response.isSuccessful) {
                    val json = JSONObject(respBody)
                    val token = json.getString("token")
                    val refreshToken = json.optString("refresh_token", "")
                    val wsUrl = serverUrl
                        .replace("https://", "wss://")
                        .replace("http://", "ws://") + "/api/voice-relay/ws"

                    getSharedPreferences("edxo_voice", MODE_PRIVATE).edit()
                        .putString("auth_token", token)
                        .putString("refresh_token", refreshToken)
                        .putString("server_base_url", serverUrl)
                        .putString("server_url", wsUrl)
                        .putString("saved_email", email)
                        .apply()

                    // Sync to phone
                    WearSyncService.pushConfigToPhone(this, token = token, refreshToken = refreshToken, serverUrl = wsUrl)

                    callback(true, "OK")
                } else {
                    val detail = try {
                        JSONObject(respBody).optString("detail", "Erreur")
                    } catch (_: Exception) { "Erreur ${response.code}" }
                    callback(false, detail)
                }
            } catch (e: Exception) {
                callback(false, e.message ?: "Erreur reseau")
            }
        }
    }
}
