package com.edxo.voice.mobile

import android.os.Bundle
import android.text.InputType
import android.util.Log
import android.view.Gravity
import android.view.View
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import com.google.android.gms.wearable.ChannelClient
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import kotlin.concurrent.thread

/**
 * Phone companion app for EDxo Voice.
 *
 * - Login with email/password -> auto-syncs token to watch
 * - Configure server URL
 * - Select workflow -> auto-syncs to watch
 * - "Installer sur la montre" button pushes the watch APK via Channel API
 */
class CompanionActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "EDxoCompanion"
        private const val CONFIG_PATH = "/edxo-voice-config"
        private const val APK_CHANNEL_PATH = "/edxo-voice-apk"
        private const val WATCH_APK_ASSET = "edxo-voice-watch.apk"
        private const val DEFAULT_URL = "https://chatkit.ve2fpd.com"
    }

    private data class WorkflowItem(val id: Int, val name: String)

    private lateinit var serverUrlInput: EditText
    private lateinit var emailInput: EditText
    private lateinit var passwordInput: EditText
    private lateinit var loginBtn: Button
    private lateinit var statusLabel: TextView
    private lateinit var watchStatusLabel: TextView
    private lateinit var workflowSpinner: Spinner
    private lateinit var syncBtn: Button
    private lateinit var installWatchBtn: Button
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
            text = "Configuration"
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

        // Watch sync status
        watchStatusLabel = TextView(this).apply {
            gravity = Gravity.CENTER
            textSize = 12f
            setTextColor(0xFF888888.toInt())
        }
        configSection.addView(watchStatusLabel, lp(topMargin = 16))

        // Install on watch button
        installWatchBtn = Button(this).apply {
            text = "Installer sur la montre"
            setOnClickListener { installOnWatch() }
        }
        configSection.addView(installWatchBtn, lp(topMargin = 8))

        // Manual sync button (fallback)
        syncBtn = Button(this).apply {
            text = "Re-synchroniser la montre"
            setOnClickListener { syncToWatch() }
        }
        configSection.addView(syncBtn, lp(topMargin = 8))

        root.addView(configSection, lp())

        scroll.addView(root)
        setContentView(scroll)

        // Auto-login if token exists
        token = prefs.getString("auth_token", "") ?: ""
        if (token.isNotEmpty()) {
            statusLabel.text = "Connecte"
            statusLabel.setTextColor(0xFF44AA44.toInt())
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

    // --- Login ---

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
        statusLabel.setTextColor(0xFF888888.toInt())

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

                    syncToWatch()

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

    // --- Workflows ---

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

                    val lastId = getSharedPreferences("edxo_voice", MODE_PRIVATE)
                        .getInt("workflow_id", 0)
                    val idx = workflows.indexOfFirst { it.id == lastId }
                    if (idx >= 0) workflowSpinner.setSelection(idx)

                    workflowSpinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
                        override fun onItemSelected(parent: AdapterView<*>?, view: View?, pos: Int, id: Long) {
                            val prev = selectedWorkflow
                            selectedWorkflow = workflows.getOrNull(pos)
                            if (prev != null && selectedWorkflow != prev) {
                                syncToWatch()
                            }
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

    // --- Sync config to watch ---

    private fun syncToWatch() {
        val baseUrl = getBaseUrl()
        val wsUrl = baseUrl
            .replace("https://", "wss://")
            .replace("http://", "ws://") + "/api/voice-relay/ws"

        val wf = selectedWorkflow

        val prefs = getSharedPreferences("edxo_voice", MODE_PRIVATE).edit()
        if (wf != null) {
            prefs.putInt("workflow_id", wf.id)
            prefs.putString("workflow_name", wf.name)
        }
        prefs.apply()

        val dataReq = PutDataMapRequest.create(CONFIG_PATH).apply {
            dataMap.putString("auth_token", token)
            dataMap.putString("server_url", wsUrl)
            if (wf != null) {
                dataMap.putInt("workflow_id", wf.id)
                dataMap.putString("workflow_name", wf.name)
            }
            dataMap.putLong("timestamp", System.currentTimeMillis())
        }.asPutDataRequest().setUrgent()

        Wearable.getDataClient(this).putDataItem(dataReq)
            .addOnSuccessListener {
                val msg = if (wf != null) "Montre synchronisee (${wf.name})" else "Token envoye a la montre"
                Log.i(TAG, "Synced to watch: url=$wsUrl, workflow=${wf?.name}")
                runOnUiThread {
                    watchStatusLabel.text = msg
                    watchStatusLabel.setTextColor(0xFF44AA44.toInt())
                }
            }
            .addOnFailureListener { e ->
                Log.e(TAG, "Failed to sync to watch", e)
                runOnUiThread {
                    watchStatusLabel.text = "Montre non connectee"
                    watchStatusLabel.setTextColor(0xFFCC8800.toInt())
                }
            }
    }

    // --- Install APK on watch ---

    private fun installOnWatch() {
        // Check if watch APK is bundled in assets
        val assetExists = try {
            assets.open(WATCH_APK_ASSET).close()
            true
        } catch (_: Exception) {
            false
        }

        if (!assetExists) {
            Toast.makeText(this, "APK montre non inclus dans cette version", Toast.LENGTH_LONG).show()
            return
        }

        installWatchBtn.isEnabled = false
        installWatchBtn.text = "Envoi en cours..."
        watchStatusLabel.text = "Recherche de la montre..."
        watchStatusLabel.setTextColor(0xFF888888.toInt())

        // Find connected watch nodes
        Wearable.getNodeClient(this).connectedNodes
            .addOnSuccessListener { nodes ->
                if (nodes.isEmpty()) {
                    installWatchBtn.isEnabled = true
                    installWatchBtn.text = "Installer sur la montre"
                    watchStatusLabel.text = "Aucune montre connectee"
                    watchStatusLabel.setTextColor(0xFFCC4444.toInt())
                    return@addOnSuccessListener
                }

                // Send to first connected watch
                val watchNode = nodes.first()
                watchStatusLabel.text = "Envoi vers ${watchNode.displayName}..."

                thread {
                    try {
                        // Copy APK from assets to a temp file
                        val tempFile = File(cacheDir, WATCH_APK_ASSET)
                        assets.open(WATCH_APK_ASSET).use { input ->
                            FileOutputStream(tempFile).use { output ->
                                input.copyTo(output)
                            }
                        }

                        val uri = android.net.Uri.fromFile(tempFile)

                        // Open a channel to the watch and send the file
                        val channelClient = Wearable.getChannelClient(this)
                        val channelTask = channelClient.openChannel(watchNode.id, APK_CHANNEL_PATH)

                        channelTask
                            .addOnSuccessListener { channel ->
                                channelClient.sendFile(channel, uri)
                                    .addOnSuccessListener {
                                        channelClient.close(channel)
                                        tempFile.delete()
                                        Log.i(TAG, "APK sent to watch: ${watchNode.displayName}")
                                        runOnUiThread {
                                            installWatchBtn.isEnabled = true
                                            installWatchBtn.text = "Installer sur la montre"
                                            watchStatusLabel.text = "APK envoye! Installation en cours sur la montre..."
                                            watchStatusLabel.setTextColor(0xFF44AA44.toInt())
                                        }
                                    }
                                    .addOnFailureListener { e ->
                                        channelClient.close(channel)
                                        tempFile.delete()
                                        Log.e(TAG, "Failed to send APK", e)
                                        runOnUiThread {
                                            installWatchBtn.isEnabled = true
                                            installWatchBtn.text = "Installer sur la montre"
                                            watchStatusLabel.text = "Erreur envoi: ${e.message}"
                                            watchStatusLabel.setTextColor(0xFFCC4444.toInt())
                                        }
                                    }
                            }
                            .addOnFailureListener { e ->
                                tempFile.delete()
                                Log.e(TAG, "Failed to open channel", e)
                                runOnUiThread {
                                    installWatchBtn.isEnabled = true
                                    installWatchBtn.text = "Installer sur la montre"
                                    watchStatusLabel.text = "Erreur canal: ${e.message}"
                                    watchStatusLabel.setTextColor(0xFFCC4444.toInt())
                                }
                            }
                    } catch (e: Exception) {
                        Log.e(TAG, "Error preparing APK", e)
                        runOnUiThread {
                            installWatchBtn.isEnabled = true
                            installWatchBtn.text = "Installer sur la montre"
                            watchStatusLabel.text = "Erreur: ${e.message}"
                            watchStatusLabel.setTextColor(0xFFCC4444.toInt())
                        }
                    }
                }
            }
            .addOnFailureListener { e ->
                installWatchBtn.isEnabled = true
                installWatchBtn.text = "Installer sur la montre"
                watchStatusLabel.text = "Erreur: ${e.message}"
                watchStatusLabel.setTextColor(0xFFCC4444.toInt())
            }
    }
}
