package com.edxo.voice.mobile

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.drawable.GradientDrawable
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.os.Bundle
import android.os.PowerManager
import android.util.Base64
import android.util.Log
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/**
 * Full-screen voice assistant activity for the phone.
 * Same voice engine as the Wear OS app.
 */
class VoiceActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "EDxoVoice"
        private const val PERMISSION_REQUEST_CODE = 1001
        private const val SAMPLE_RATE = 24000
        private const val CHANNEL_IN = AudioFormat.CHANNEL_IN_MONO
        private const val CHANNEL_OUT = AudioFormat.CHANNEL_OUT_MONO
        private const val ENCODING = AudioFormat.ENCODING_PCM_16BIT
    }

    private var webSocket: WebSocket? = null
    private var audioRecord: AudioRecord? = null
    private var audioTrack: AudioTrack? = null
    private var wakeLock: PowerManager.WakeLock? = null

    private var isRecording = false
    private var isConnected = false
    private var hasAttemptedRefresh = false

    private lateinit var micButton: ImageButton
    private lateinit var statusText: TextView
    private lateinit var workflowText: TextView
    private lateinit var progressBar: ProgressBar

    private var workflowId: Int = 0
    private var workflowName: String = ""

    private val pickWorkflow = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val data = result.data ?: return@registerForActivityResult
            workflowId = data.getIntExtra("workflow_id", 0)
            workflowName = data.getStringExtra("workflow_name") ?: ""
            saveSelectedWorkflow()
            workflowText.text = workflowName.ifEmpty { "Choisir workflow" }

            // Sync workflow choice to watch
            WearSyncHelper.pushConfigToWatch(this, workflowId = workflowId, workflowName = workflowName)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        loadSelectedWorkflow()

        val root = FrameLayout(this).apply {
            setBackgroundColor(0xFF0D1117.toInt())
        }

        // Close button (top-left)
        val closeBtn = ImageButton(this).apply {
            setImageResource(android.R.drawable.ic_menu_close_clear_cancel)
            setBackgroundColor(0x00000000)
            setColorFilter(0xFFFFFFFF.toInt())
            setOnClickListener { finish() }
        }
        root.addView(closeBtn, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT
        ).apply { gravity = Gravity.TOP or Gravity.START; topMargin = 48; marginStart = 16 })

        // Workflow name
        workflowText = TextView(this).apply {
            text = workflowName.ifEmpty { "Choisir workflow" }
            setTextColor(0xFF6688CC.toInt())
            textSize = 16f
            gravity = Gravity.CENTER
            setOnClickListener { openWorkflowPicker() }
        }
        root.addView(workflowText, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.WRAP_CONTENT
        ).apply { gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL; topMargin = 120 })

        // Status
        statusText = TextView(this).apply {
            text = "Appuyez pour parler"
            setTextColor(0xFFAAAAAA.toInt())
            textSize = 14f
            gravity = Gravity.CENTER
        }
        root.addView(statusText, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.WRAP_CONTENT
        ).apply { gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL; topMargin = 160 })

        // Mic button — large round
        micButton = ImageButton(this).apply {
            setImageResource(android.R.drawable.ic_btn_speak_now)
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(0xFF1A1A2E.toInt())
                setStroke((3 * resources.displayMetrics.density).toInt(), 0xFF6688CC.toInt())
            }
            scaleType = android.widget.ImageView.ScaleType.CENTER_INSIDE
            val pad = (28 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad, pad, pad)
            contentDescription = "Microphone"
            setColorFilter(0xFFFFFFFF.toInt())
            setOnClickListener { toggleRecording() }
        }
        val btnPx = (120 * resources.displayMetrics.density).toInt()
        root.addView(micButton, FrameLayout.LayoutParams(btnPx, btnPx).apply {
            gravity = Gravity.CENTER
        })

        progressBar = ProgressBar(this, null, android.R.attr.progressBarStyleSmall).apply {
            visibility = View.GONE
        }
        root.addView(progressBar, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT
        ).apply { gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL; bottomMargin = 80 })

        setContentView(root)

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.RECORD_AUDIO), PERMISSION_REQUEST_CODE)
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == PERMISSION_REQUEST_CODE && grantResults.isNotEmpty()
            && grantResults[0] != PackageManager.PERMISSION_GRANTED) {
            Toast.makeText(this, "Permission micro requise", Toast.LENGTH_LONG).show()
        }
    }

    private fun openWorkflowPicker() {
        val token = getSharedPreferences("edxo_voice", MODE_PRIVATE).getString("auth_token", null)
        if (token.isNullOrEmpty()) {
            Toast.makeText(this, "Connectez-vous d'abord", Toast.LENGTH_SHORT).show()
            return
        }
        pickWorkflow.launch(Intent(this, WorkflowPickerActivity::class.java))
    }

    private fun toggleRecording() {
        if (isRecording) {
            stopSession()
        } else {
            if (workflowId <= 0) {
                Toast.makeText(this, "Choisissez un workflow d'abord", Toast.LENGTH_SHORT).show()
                openWorkflowPicker()
                return
            }
            startSession()
        }
    }

    private fun startSession() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED) {
            Toast.makeText(this, "Permission micro requise", Toast.LENGTH_SHORT).show()
            return
        }
        isRecording = true
        hasAttemptedRefresh = false
        updateUI(recording = true, status = "Connexion...")
        acquireWakeLock()
        connectWebSocket()
    }

    private fun stopSession() {
        isRecording = false
        updateUI(recording = false, status = "Appuyez pour parler")
        stopAudioCapture()
        stopAudioPlayback()
        webSocket?.let {
            try { it.send(JSONObject().put("type", "stop").toString()) } catch (_: Exception) {}
            it.close(1000, "User stopped")
        }
        webSocket = null
        isConnected = false
        releaseWakeLock()
    }

    private fun connectWebSocket() {
        val token = getSharedPreferences("edxo_voice", MODE_PRIVATE).getString("auth_token", null)
        if (token.isNullOrEmpty()) {
            runOnUiThread { updateUI(recording = false, status = "Non connecte") }
            isRecording = false
            releaseWakeLock()
            return
        }

        val serverUrl = getSharedPreferences("edxo_voice", MODE_PRIVATE)
            .getString("server_url", BuildConfig.BACKEND_WS_URL) ?: BuildConfig.BACKEND_WS_URL
        val url = "$serverUrl?token=$token"

        val client = OkHttpClient.Builder().readTimeout(0, TimeUnit.MILLISECONDS).build()
        client.newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                Log.i(TAG, "WebSocket connected")
                webSocket = ws
                isConnected = true
                ws.send(JSONObject().put("type", "start").put("workflow_id", workflowId).toString())
                runOnUiThread { updateUI(recording = true, status = "Connexion...") }
            }

            override fun onMessage(ws: WebSocket, text: String) {
                handleServerMessage(text)
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "WebSocket failure: ${t.message}", t)
                isConnected = false
                if (!hasAttemptedRefresh) {
                    attemptRefreshAndReconnect()
                } else {
                    isRecording = false
                    releaseWakeLock()
                    runOnUiThread {
                        updateUI(recording = false, status = "Session expiree")
                        Toast.makeText(this@VoiceActivity, "Session expiree", Toast.LENGTH_SHORT).show()
                        redirectToLogin()
                    }
                }
            }

            override fun onClosing(ws: WebSocket, code: Int, reason: String) {
                ws.close(1000, null)
                isConnected = false
                if (code == 4001 || code == 4003) {
                    if (!hasAttemptedRefresh) {
                        attemptRefreshAndReconnect()
                        return
                    } else {
                        runOnUiThread {
                            Toast.makeText(this@VoiceActivity, "Session expiree", Toast.LENGTH_SHORT).show()
                            redirectToLogin()
                        }
                    }
                }
                if (isRecording) {
                    isRecording = false
                    runOnUiThread { updateUI(recording = false, status = "Deconnecte") }
                    releaseWakeLock()
                }
            }
        })
    }

    private fun handleServerMessage(text: String) {
        try {
            val json = JSONObject(text)
            when (json.optString("type")) {
                "ready" -> {
                    val wfName = json.optString("workflow_name", "")
                    if (wfName.isNotEmpty()) {
                        workflowName = wfName
                        runOnUiThread { workflowText.text = wfName }
                    }
                    runOnUiThread { updateUI(recording = true, status = "Ecoute...") }
                    startAudioCapture()
                    initAudioPlayback()
                }
                "audio" -> {
                    val pcm = Base64.decode(json.getString("data"), Base64.NO_WRAP)
                    playAudio(pcm)
                }
                "status" -> {
                    val msg = json.optString("text", "")
                    runOnUiThread { updateUI(recording = true, status = msg) }
                }
                "error" -> {
                    val msg = json.optString("message", "Erreur")
                    runOnUiThread { Toast.makeText(this, msg, Toast.LENGTH_SHORT).show() }
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error parsing message", e)
        }
    }

    private fun startAudioCapture() {
        val bufferSize = AudioRecord.getMinBufferSize(SAMPLE_RATE, CHANNEL_IN, ENCODING)
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED) return

        audioRecord = AudioRecord(MediaRecorder.AudioSource.MIC, SAMPLE_RATE, CHANNEL_IN, ENCODING, bufferSize * 2)
        audioRecord?.startRecording()

        thread(isDaemon = true, name = "AudioCapture") {
            val buffer = ByteArray(bufferSize)
            while (isRecording && isConnected) {
                val read = audioRecord?.read(buffer, 0, buffer.size) ?: -1
                if (read > 0) {
                    val b64 = Base64.encodeToString(buffer.copyOf(read), Base64.NO_WRAP)
                    try {
                        webSocket?.send(JSONObject().put("type", "audio").put("data", b64).toString())
                    } catch (_: Exception) { break }
                }
            }
        }
    }

    private fun stopAudioCapture() {
        try { audioRecord?.stop(); audioRecord?.release() } catch (_: Exception) {}
        audioRecord = null
    }

    private fun initAudioPlayback() {
        val bufferSize = AudioTrack.getMinBufferSize(SAMPLE_RATE, CHANNEL_OUT, ENCODING)
        audioTrack = AudioTrack(
            AudioManager.STREAM_MUSIC, SAMPLE_RATE, CHANNEL_OUT, ENCODING,
            bufferSize * 2, AudioTrack.MODE_STREAM
        )
        audioTrack?.play()
    }

    private fun playAudio(pcm: ByteArray) {
        try { audioTrack?.write(pcm, 0, pcm.size) } catch (_: Exception) {}
    }

    private fun stopAudioPlayback() {
        try { audioTrack?.stop(); audioTrack?.release() } catch (_: Exception) {}
        audioTrack = null
    }

    private fun attemptRefreshAndReconnect() {
        hasAttemptedRefresh = true
        Log.i(TAG, "Attempting token refresh...")
        runOnUiThread { updateUI(recording = true, status = "Reconnexion...") }
        thread {
            val success = TokenRefresher.refresh(this)
            if (success) {
                Log.i(TAG, "Token refreshed, reconnecting WebSocket")
                connectWebSocket()
            } else {
                isRecording = false
                releaseWakeLock()
                runOnUiThread {
                    updateUI(recording = false, status = "Session expiree")
                    Toast.makeText(this, "Session expiree", Toast.LENGTH_SHORT).show()
                    redirectToLogin()
                }
            }
        }
    }

    private fun redirectToLogin() {
        // Clear auth tokens but keep login info (email, server URL)
        getSharedPreferences("edxo_voice", MODE_PRIVATE).edit()
            .remove("auth_token")
            .remove("refresh_token")
            .apply()
        startActivity(Intent(this, LoginActivity::class.java))
        finish()
    }

    private fun updateUI(recording: Boolean, status: String) {
        micButton.alpha = if (recording) 1.0f else 0.7f
        micButton.setColorFilter(if (recording) 0xFFFF4444.toInt() else 0xFFFFFFFF.toInt())
        (micButton.background as? GradientDrawable)?.apply {
            if (recording) {
                setColor(0xFF2A1020.toInt())
                setStroke((3 * resources.displayMetrics.density).toInt(), 0xFFFF4444.toInt())
            } else {
                setColor(0xFF1A1A2E.toInt())
                setStroke((3 * resources.displayMetrics.density).toInt(), 0xFF6688CC.toInt())
            }
        }
        statusText.text = status
        progressBar.visibility = if (recording && !isConnected) View.VISIBLE else View.GONE
    }

    private fun saveSelectedWorkflow() {
        getSharedPreferences("edxo_voice", MODE_PRIVATE).edit()
            .putInt("workflow_id", workflowId)
            .putString("workflow_name", workflowName)
            .apply()
    }

    private fun loadSelectedWorkflow() {
        val prefs = getSharedPreferences("edxo_voice", MODE_PRIVATE)
        workflowId = prefs.getInt("workflow_id", 0)
        workflowName = prefs.getString("workflow_name", "") ?: ""
    }

    @Suppress("DEPRECATION")
    private fun acquireWakeLock() {
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "edxo:voice-session")
        wakeLock?.acquire(10 * 60 * 1000L)
    }

    private fun releaseWakeLock() {
        try { if (wakeLock?.isHeld == true) wakeLock?.release() } catch (_: Exception) {}
        wakeLock = null
    }

    override fun onDestroy() {
        stopSession()
        super.onDestroy()
    }
}
