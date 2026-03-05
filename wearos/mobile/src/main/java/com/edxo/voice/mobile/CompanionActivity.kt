package com.edxo.voice.mobile

import android.os.Bundle
import android.text.InputType
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import kotlin.concurrent.thread

/**
 * Phone companion app for EDxo Voice.
 *
 * - Login with email/password
 * - Configure server URL
 * - Select workflow
 * - Push config to Wear OS watch via Data Layer API
 */
class CompanionActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "EDxoCompanion"
        private const val CONFIG_PATH = "/edxo-voice-config"
        private const val DEFAULT_URL = "https://chatkit.ve2fpd.com"
    }

    private data class WorkflowItem(val id: Int, val name: String)

    private lateinit var serverUrlInput: EditText
    private lateinit var emailInput: EditText
    private lateinit var passwordInput: EditText
    private lateinit var loginBtn: Button
    private lateinit var statusLabel: TextView
    private lateinit var workflowSpinner: Spinner
    private lateinit var syncBtn: Button
    private lateinit var configSection: LinearLayout

    private var token: String = ""
    private var workflows = listOf<WorkflowItem>()
    private var selectedWorkflow: WorkflowItem? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val prefs = getSharedPreferences("edxo_voice", MODE_PRIVATE)

        val scroll = ScrollView(this)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 48, 48, 48)
        }

        // Title
        root.addView(TextView(this).apply {
            text = "EDxo Voice"
            textSize = 24f
            gravity = Gravity.CENTER
        }, lp())

        root.addView(TextView(this).apply {
            text = "Configuration de la montre"
            textSize = 14f
            gravity = Gravity.CENTER
            setTextColor(0xFF888888.toInt())
        }, lp(topMargin = 4))

        // Server URL
        root.addView(label("Adresse du serveur"), lp(topMargin = 32))
        serverUrlInput = EditText(this).apply {
            setText(prefs.getString("server_url", DEFAULT_URL))
            inputType = InputType.TYPE_TEXT_VARIATION_URI
            maxLines = 1
        }
        root.addView(serverUrlInput, lp(topMargin = 4))

        // Email
        root.addView(label("Email"), lp(topMargin = 16))
        emailInput = EditText(this).apply {
            setText(prefs.getString("email", ""))
            inputType = InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
            maxLines = 1
        }
        root.addView(emailInput, lp(topMargin = 4))

        // Password
        root.addView(label("Mot de passe"), lp(topMargin = 16))
        passwordInput = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            maxLines = 1
        }
        root.addView(passwordInput, lp(topMargin = 4))

        // Login button
        loginBtn = Button(this).apply {
            text = "Se connecter"
            setOnClickListener { doLogin() }
        }
        root.addView(loginBtn, lp(topMargin = 16))

        statusLabel = TextView(this).apply {
            gravity = Gravity.CENTER
            textSize = 13f
        }
        root.addView(statusLabel, lp(topMargin = 8))

        // Config section (hidden until logged in)
        configSection = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            visibility = View.GONE
        }

        configSection.addView(label("Workflow"), lp(topMargin = 24))
        workflowSpinner = Spinner(this)
        configSection.addView(workflowSpinner, lp(topMargin = 4))

        syncBtn = Button(this).apply {
            text = "Envoyer a la montre"
            setOnClickListener { syncToWatch() }
        }
        configSection.addView(syncBtn, lp(topMargin = 24))

        root.addView(configSection, lp())

        scroll.addView(root)
        setContentView(scroll)

        // Auto-login if token exists
        token = prefs.getString("auth_token", "") ?: ""
        if (token.isNotEmpty()) {
            statusLabel.text = "Connecte"
            loadWorkflows()
        }
    }

    private fun label(text: String) = TextView(this).apply {
        this.text = text
        textSize = 14f
    }

    private fun lp(topMargin: Int = 0) = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT
    ).apply { this.topMargin = topMargin }

    private fun getBaseUrl(): String {
        var url = serverUrlInput.text.toString().trim()
        if (url.endsWith("/")) url = url.dropLast(1)
        return url
    }

    private fun doLogin() {
        val email = emailInput.text.toString().trim()
        val password = passwordInput.text.toString()
        val baseUrl = getBaseUrl()

        if (email.isEmpty() || password.isEmpty()) {
            statusLabel.text = "Email et mot de passe requis"
            return
        }

        loginBtn.isEnabled = false
        statusLabel.text = "Connexion..."

        thread {
            try {
                val body = JSONObject()
                    .put("email", email)
                    .put("password", password)
                    .toString()

                val response = OkHttpClient().newCall(
                    Request.Builder()
                        .url("$baseUrl/api/voice-relay/auth")
                        .post(body.toRequestBody("application/json".toMediaType()))
                        .build()
                ).execute()

                val respBody = response.body?.string() ?: ""

                if (response.isSuccessful) {
                    token = JSONObject(respBody).getString("token")
                    getSharedPreferences("edxo_voice", MODE_PRIVATE).edit()
                        .putString("auth_token", token)
                        .putString("server_url", baseUrl)
                        .putString("email", email)
                        .apply()

                    runOnUiThread {
                        loginBtn.isEnabled = true
                        statusLabel.text = "Connecte!"
                        statusLabel.setTextColor(0xFF44AA44.toInt())
                        loadWorkflows()
                    }
                } else {
                    val detail = try {
                        JSONObject(respBody).optString("detail", "Erreur")
                    } catch (_: Exception) { "Erreur ${response.code}" }
                    runOnUiThread {
                        loginBtn.isEnabled = true
                        statusLabel.text = detail
                        statusLabel.setTextColor(0xFFCC4444.toInt())
                    }
                }
            } catch (e: Exception) {
                runOnUiThread {
                    loginBtn.isEnabled = true
                    statusLabel.text = e.message ?: "Erreur reseau"
                    statusLabel.setTextColor(0xFFCC4444.toInt())
                }
            }
        }
    }

    private fun loadWorkflows() {
        thread {
            try {
                val baseUrl = getBaseUrl()
                val response = OkHttpClient().newCall(
                    Request.Builder()
                        .url("$baseUrl/api/voice-relay/workflows")
                        .header("Authorization", "Bearer $token")
                        .build()
                ).execute()

                val body = response.body?.string() ?: "[]"
                if (!response.isSuccessful) {
                    runOnUiThread { statusLabel.text = "Erreur chargement workflows" }
                    return@thread
                }

                val arr = JSONArray(body)
                workflows = (0 until arr.length()).map { i ->
                    val obj = arr.getJSONObject(i)
                    WorkflowItem(obj.getInt("id"), obj.getString("name"))
                }

                runOnUiThread {
                    configSection.visibility = View.VISIBLE
                    val names = workflows.map { it.name }
                    workflowSpinner.adapter = ArrayAdapter(
                        this, android.R.layout.simple_spinner_dropdown_item, names
                    )

                    // Restore last selection
                    val lastId = getSharedPreferences("edxo_voice", MODE_PRIVATE)
                        .getInt("workflow_id", 0)
                    val idx = workflows.indexOfFirst { it.id == lastId }
                    if (idx >= 0) workflowSpinner.setSelection(idx)

                    workflowSpinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
                        override fun onItemSelected(parent: AdapterView<*>?, view: View?, pos: Int, id: Long) {
                            selectedWorkflow = workflows.getOrNull(pos)
                        }
                        override fun onNothingSelected(parent: AdapterView<*>?) {}
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error loading workflows", e)
                runOnUiThread { statusLabel.text = "Erreur: ${e.message}" }
            }
        }
    }

    private fun syncToWatch() {
        val wf = selectedWorkflow
        if (wf == null) {
            Toast.makeText(this, "Selectionnez un workflow", Toast.LENGTH_SHORT).show()
            return
        }

        val baseUrl = getBaseUrl()
        val wsUrl = baseUrl
            .replace("https://", "wss://")
            .replace("http://", "ws://") + "/api/voice-relay/ws"

        // Save locally
        getSharedPreferences("edxo_voice", MODE_PRIVATE).edit()
            .putInt("workflow_id", wf.id)
            .putString("workflow_name", wf.name)
            .apply()

        // Push to watch via Data Layer
        val dataReq = PutDataMapRequest.create(CONFIG_PATH).apply {
            dataMap.putString("auth_token", token)
            dataMap.putString("server_url", wsUrl)
            dataMap.putInt("workflow_id", wf.id)
            dataMap.putString("workflow_name", wf.name)
            dataMap.putLong("timestamp", System.currentTimeMillis())
        }.asPutDataRequest().setUrgent()

        Wearable.getDataClient(this).putDataItem(dataReq)
            .addOnSuccessListener {
                Log.i(TAG, "Config sent to watch: workflow=${wf.name}, url=$wsUrl")
                Toast.makeText(this, "Envoye a la montre!", Toast.LENGTH_SHORT).show()
            }
            .addOnFailureListener { e ->
                Log.e(TAG, "Failed to send config to watch", e)
                Toast.makeText(this, "Erreur: ${e.message}", Toast.LENGTH_LONG).show()
            }
    }
}
