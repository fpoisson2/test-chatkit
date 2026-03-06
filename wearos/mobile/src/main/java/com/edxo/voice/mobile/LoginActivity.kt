package com.edxo.voice.mobile

import android.content.Intent
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

class LoginActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // If already logged in, go straight to main
        val prefs = getSharedPreferences("edxo_voice", MODE_PRIVATE)
        if (!prefs.getString("auth_token", null).isNullOrEmpty()) {
            startMain()
            return
        }

        val scroll = ScrollView(this).apply {
            setBackgroundColor(0xFF0D1117.toInt())
        }

        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(48, 120, 48, 48)
        }

        val title = TextView(this).apply {
            text = "EDxo"
            setTextColor(0xFFFFFFFF.toInt())
            textSize = 28f
            gravity = Gravity.CENTER
        }
        layout.addView(title)

        val subtitle = TextView(this).apply {
            text = "Connectez-vous a votre serveur"
            setTextColor(0xFFAAAAAA.toInt())
            textSize = 14f
            gravity = Gravity.CENTER
        }
        layout.addView(subtitle, lp(topMargin = 8))

        // Server URL
        val urlLabel = TextView(this).apply {
            text = "Adresse du serveur"
            setTextColor(0xFF8899BB.toInt())
            textSize = 12f
        }
        layout.addView(urlLabel, lp(topMargin = 40))

        val urlInput = EditText(this).apply {
            hint = "https://chatkit.example.com"
            setText(prefs.getString("server_base_url", ""))
            setTextColor(0xFFFFFFFF.toInt())
            setHintTextColor(0xFF555555.toInt())
            textSize = 15f
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            imeOptions = EditorInfo.IME_ACTION_NEXT
            maxLines = 1
            setBackgroundColor(0xFF161B22.toInt())
            setPadding(24, 20, 24, 20)
        }
        layout.addView(urlInput, lp(topMargin = 4))

        // Email
        val emailLabel = TextView(this).apply {
            text = "Email"
            setTextColor(0xFF8899BB.toInt())
            textSize = 12f
        }
        layout.addView(emailLabel, lp(topMargin = 24))

        val emailInput = EditText(this).apply {
            hint = "admin@example.com"
            setText(prefs.getString("saved_email", ""))
            setTextColor(0xFFFFFFFF.toInt())
            setHintTextColor(0xFF555555.toInt())
            textSize = 15f
            inputType = InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
            imeOptions = EditorInfo.IME_ACTION_NEXT
            maxLines = 1
            setBackgroundColor(0xFF161B22.toInt())
            setPadding(24, 20, 24, 20)
        }
        layout.addView(emailInput, lp(topMargin = 4))

        // Password
        val pwLabel = TextView(this).apply {
            text = "Mot de passe"
            setTextColor(0xFF8899BB.toInt())
            textSize = 12f
        }
        layout.addView(pwLabel, lp(topMargin = 24))

        val passwordInput = EditText(this).apply {
            hint = "Mot de passe"
            setTextColor(0xFFFFFFFF.toInt())
            setHintTextColor(0xFF555555.toInt())
            textSize = 15f
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            imeOptions = EditorInfo.IME_ACTION_DONE
            maxLines = 1
            setBackgroundColor(0xFF161B22.toInt())
            setPadding(24, 20, 24, 20)
        }
        layout.addView(passwordInput, lp(topMargin = 4))

        val loginBtn = Button(this).apply {
            text = "Se connecter"
            setOnClickListener {
                val serverUrl = urlInput.text.toString().trim().trimEnd('/')
                val email = emailInput.text.toString().trim()
                val password = passwordInput.text.toString()

                if (serverUrl.isEmpty()) {
                    Toast.makeText(this@LoginActivity, "Adresse du serveur requise", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }
                if (email.isEmpty() || password.isEmpty()) {
                    Toast.makeText(this@LoginActivity, "Email et mot de passe requis", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }

                isEnabled = false
                text = "Connexion..."
                doLogin(serverUrl, email, password) { success, message ->
                    runOnUiThread {
                        isEnabled = true
                        text = "Se connecter"
                        if (success) {
                            Toast.makeText(this@LoginActivity, "Connecte!", Toast.LENGTH_SHORT).show()
                            startMain()
                        } else {
                            Toast.makeText(this@LoginActivity, message, Toast.LENGTH_SHORT).show()
                        }
                    }
                }
            }
        }
        layout.addView(loginBtn, lp(topMargin = 32))

        scroll.addView(layout)
        setContentView(scroll)
    }

    private fun startMain() {
        startActivity(Intent(this, MainActivity::class.java))
        finish()
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
                    val token = JSONObject(respBody).getString("token")
                    val wsUrl = serverUrl
                        .replace("https://", "wss://")
                        .replace("http://", "ws://") + "/api/voice-relay/ws"

                    getSharedPreferences("edxo_voice", MODE_PRIVATE).edit()
                        .putString("auth_token", token)
                        .putString("server_base_url", serverUrl)
                        .putString("server_url", wsUrl)
                        .putString("saved_email", email)
                        .apply()

                    // Sync to watch
                    WearSyncHelper.pushConfigToWatch(this, token = token, serverUrl = wsUrl)

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
