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

/**
 * Login screen — authenticates with email/password via the backend
 * and stores the JWT token.
 */
class TokenSetupActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val scroll = ScrollView(this).apply {
            setBackgroundColor(0xFF000000.toInt())
        }

        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(24, 32, 24, 24)
        }

        val title = TextView(this).apply {
            text = "EDxo Voice"
            setTextColor(0xFFFFFFFF.toInt())
            textSize = 16f
            gravity = Gravity.CENTER
        }
        layout.addView(title)

        val subtitle = TextView(this).apply {
            text = "Connexion admin"
            setTextColor(0xFFAAAAAA.toInt())
            textSize = 11f
            gravity = Gravity.CENTER
        }
        layout.addView(subtitle, lp(topMargin = 4))

        val emailInput = EditText(this).apply {
            hint = "Email"
            setTextColor(0xFFFFFFFF.toInt())
            setHintTextColor(0xFF888888.toInt())
            textSize = 12f
            inputType = InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
            imeOptions = EditorInfo.IME_ACTION_NEXT
            maxLines = 1
        }
        layout.addView(emailInput, lp(topMargin = 16))

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

        // Load saved email
        val prefs = getSharedPreferences("edxo_voice", MODE_PRIVATE)
        prefs.getString("saved_email", null)?.let { emailInput.setText(it) }

        val loginBtn = Button(this).apply {
            text = "Se connecter"
            setOnClickListener {
                val email = emailInput.text.toString().trim()
                val password = passwordInput.text.toString()
                if (email.isEmpty() || password.isEmpty()) {
                    Toast.makeText(this@TokenSetupActivity, "Email et mot de passe requis", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }
                isEnabled = false
                text = "Connexion..."
                doLogin(email, password) { success, message ->
                    runOnUiThread {
                        isEnabled = true
                        text = "Se connecter"
                        if (success) {
                            prefs.edit().putString("saved_email", email).apply()
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

        // Fallback: paste raw token
        val tokenToggle = TextView(this).apply {
            text = "Coller un token manuellement"
            setTextColor(0xFF6688CC.toInt())
            textSize = 10f
            gravity = Gravity.CENTER
            setOnClickListener {
                val rawInput = EditText(this@TokenSetupActivity).apply {
                    hint = "JWT token"
                    setTextColor(0xFFFFFFFF.toInt())
                    setHintTextColor(0xFF888888.toInt())
                    textSize = 10f
                    maxLines = 3
                }
                layout.addView(rawInput, layout.indexOfChild(this), lp(topMargin = 8))

                val saveBtn = Button(this@TokenSetupActivity).apply {
                    text = "Enregistrer"
                    setOnClickListener {
                        val t = rawInput.text.toString().trim()
                        if (t.isNotEmpty()) {
                            prefs.edit().putString("auth_token", t).apply()
                            Toast.makeText(this@TokenSetupActivity, "Token sauvegarde", Toast.LENGTH_SHORT).show()
                            finish()
                        }
                    }
                }
                layout.addView(saveBtn, layout.indexOfChild(rawInput) + 1, lp(topMargin = 4))
                visibility = android.view.View.GONE
            }
        }
        layout.addView(tokenToggle, lp(topMargin = 16))

        scroll.addView(layout)
        setContentView(scroll)
    }

    private fun lp(topMargin: Int = 0) = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT
    ).apply { this.topMargin = topMargin }

    private fun doLogin(email: String, password: String, callback: (Boolean, String) -> Unit) {
        thread {
            try {
                val body = JSONObject()
                    .put("email", email)
                    .put("password", password)
                    .toString()

                val baseUrl = BuildConfig.BACKEND_WS_URL
                    .replace("wss://", "https://")
                    .replace("ws://", "http://")
                    .replace("/api/voice-relay/ws", "")

                val request = Request.Builder()
                    .url("$baseUrl/api/voice-relay/auth")
                    .post(body.toRequestBody("application/json".toMediaType()))
                    .build()

                val response = OkHttpClient().newCall(request).execute()
                val respBody = response.body?.string() ?: ""

                if (response.isSuccessful) {
                    val token = JSONObject(respBody).getString("token")
                    getSharedPreferences("edxo_voice", MODE_PRIVATE)
                        .edit()
                        .putString("auth_token", token)
                        .apply()
                    callback(true, "OK")
                } else {
                    val detail = try {
                        JSONObject(respBody).optString("detail", "Erreur")
                    } catch (_: Exception) { "Erreur ${ response.code }" }
                    callback(false, detail)
                }
            } catch (e: Exception) {
                callback(false, e.message ?: "Erreur reseau")
            }
        }
    }
}
