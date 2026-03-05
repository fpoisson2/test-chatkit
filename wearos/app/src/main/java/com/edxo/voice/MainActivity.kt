package com.edxo.voice

import android.content.Intent
import android.Manifest
import android.content.pm.PackageManager
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

class MainActivity : AppCompatActivity() {

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

    private lateinit var micButton: ImageButton
    private lateinit var statusText: TextView
    private lateinit var progressBar: ProgressBar

    // Hardcoded workflow ID — change as needed or make configurable later
    private val workflowId = 30

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Build UI programmatically (no XML layout needed for simple watch UI)
        val root = FrameLayout(this).apply {
            setBackgroundColor(0xFF000000.toInt())
        }

        statusText = TextView(this).apply {
            text = "EDxo Voice"
            setTextColor(0xFFFFFFFF.toInt())
            textSize = 12f
            gravity = Gravity.CENTER
        }
        root.addView(statusText, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.WRAP_CONTENT
        ).apply { gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL; topMargin = 24 })

        micButton = ImageButton(this).apply {
            setImageResource(android.R.drawable.ic_btn_speak_now)
            setBackgroundResource(android.R.drawable.dialog_holo_dark_frame)
            scaleType = android.widget.ImageView.ScaleType.CENTER_INSIDE
            setPadding(16, 16, 16, 16)
            contentDescription = "Microphone"
            setOnClickListener { toggleRecording() }
        }
        val btnSize = 96
        val density = resources.displayMetrics.density
        val btnPx = (btnSize * density).toInt()
        root.addView(micButton, FrameLayout.LayoutParams(btnPx, btnPx).apply {
            gravity = Gravity.CENTER
        })

        progressBar = ProgressBar(this, null, android.R.attr.progressBarStyleSmall).apply {
            visibility = View.GONE
        }
        root.addView(progressBar, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT
        ).apply { gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL; bottomMargin = 24 })

        setContentView(root)

        // Long-press status text to open token setup
        statusText.setOnLongClickListener {
            startActivity(Intent(this, TokenSetupActivity::class.java))
            true
        }

        // Request audio permission
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(
                this,
                arrayOf(Manifest.permission.RECORD_AUDIO),
                PERMISSION_REQUEST_CODE
            )
        } else if (intent?.getBooleanExtra("auto_start", false) == true) {
            // Auto-start when launched from VoiceInteractionService (long-press home)
            startSession()
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int, permissions: Array<out String>, grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == PERMISSION_REQUEST_CODE) {
            if (grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                // Permission just granted — auto-start if launched from assistant
                if (intent?.getBooleanExtra("auto_start", false) == true) {
                    startSession()
                }
            } else {
                Toast.makeText(this, "Microphone permission required", Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun toggleRecording() {
        if (isRecording) {
            stopSession()
        } else {
            startSession()
        }
    }

    private fun startSession() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) {
            Toast.makeText(this, "Microphone permission required", Toast.LENGTH_SHORT).show()
            return
        }

        isRecording = true
        updateUI(recording = true, status = "Connexion...")

        acquireWakeLock()
        connectWebSocket()
    }

    private fun stopSession() {
        isRecording = false
        updateUI(recording = false, status = "EDxo Voice")

        stopAudioCapture()
        stopAudioPlayback()

        webSocket?.let {
            try {
                val msg = JSONObject().put("type", "stop")
                it.send(msg.toString())
            } catch (e: Exception) {
                Log.w(TAG, "Error sending stop", e)
            }
            it.close(1000, "User stopped")
        }
        webSocket = null
        isConnected = false

        releaseWakeLock()
    }

    private fun connectWebSocket() {
        val token = getStoredToken()
        if (token.isNullOrEmpty()) {
            runOnUiThread {
                updateUI(recording = false, status = "No auth token")
                Toast.makeText(this, "Set auth token first", Toast.LENGTH_LONG).show()
            }
            isRecording = false
            releaseWakeLock()
            return
        }

        val url = "${BuildConfig.BACKEND_WS_URL}?token=$token"
        Log.d(TAG, "Connecting to $url")

        val client = OkHttpClient.Builder()
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .build()

        val request = Request.Builder().url(url).build()

        client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                Log.i(TAG, "WebSocket connected")
                webSocket = ws
                isConnected = true

                // Send start message with workflow ID
                val startMsg = JSONObject()
                    .put("type", "start")
                    .put("workflow_id", workflowId)
                ws.send(startMsg.toString())

                runOnUiThread { updateUI(recording = true, status = "Connecte...") }
            }

            override fun onMessage(ws: WebSocket, text: String) {
                handleServerMessage(text)
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "WebSocket failure: ${t.message}", t)
                runOnUiThread {
                    updateUI(recording = false, status = "Erreur connexion")
                    Toast.makeText(this@MainActivity, "Connection failed", Toast.LENGTH_SHORT).show()
                }
                isRecording = false
                isConnected = false
                releaseWakeLock()
            }

            override fun onClosing(ws: WebSocket, code: Int, reason: String) {
                Log.i(TAG, "WebSocket closing: $code $reason")
                ws.close(1000, null)
                isConnected = false
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
                    Log.i(TAG, "Server ready, starting audio capture")
                    runOnUiThread { updateUI(recording = true, status = "Ecoute...") }
                    startAudioCapture()
                    initAudioPlayback()
                }
                "audio" -> {
                    // Receive audio from agent and play it
                    val b64 = json.getString("data")
                    val pcm = Base64.decode(b64, Base64.NO_WRAP)
                    playAudio(pcm)
                }
                "status" -> {
                    val statusMsg = json.optString("text", "")
                    Log.d(TAG, "Status: $statusMsg")
                    runOnUiThread { updateUI(recording = true, status = statusMsg) }
                }
                "error" -> {
                    val errorMsg = json.optString("message", "Unknown error")
                    Log.e(TAG, "Server error: $errorMsg")
                    runOnUiThread {
                        Toast.makeText(this, errorMsg, Toast.LENGTH_SHORT).show()
                    }
                }
                else -> {
                    Log.d(TAG, "Unknown message type: ${json.optString("type")}")
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error parsing server message", e)
        }
    }

    private fun startAudioCapture() {
        val bufferSize = AudioRecord.getMinBufferSize(SAMPLE_RATE, CHANNEL_IN, ENCODING)
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) return

        audioRecord = AudioRecord(
            MediaRecorder.AudioSource.MIC,
            SAMPLE_RATE,
            CHANNEL_IN,
            ENCODING,
            bufferSize * 2
        )

        audioRecord?.startRecording()

        thread(isDaemon = true, name = "AudioCapture") {
            val buffer = ByteArray(bufferSize)
            while (isRecording && isConnected) {
                val read = audioRecord?.read(buffer, 0, buffer.size) ?: -1
                if (read > 0) {
                    val b64 = Base64.encodeToString(buffer.copyOf(read), Base64.NO_WRAP)
                    val msg = JSONObject()
                        .put("type", "audio")
                        .put("data", b64)
                    try {
                        webSocket?.send(msg.toString())
                    } catch (e: Exception) {
                        Log.w(TAG, "Error sending audio", e)
                        break
                    }
                }
            }
            Log.d(TAG, "Audio capture thread exiting")
        }
    }

    private fun stopAudioCapture() {
        try {
            audioRecord?.stop()
            audioRecord?.release()
        } catch (e: Exception) {
            Log.w(TAG, "Error stopping audio record", e)
        }
        audioRecord = null
    }

    private fun initAudioPlayback() {
        val bufferSize = AudioTrack.getMinBufferSize(SAMPLE_RATE, CHANNEL_OUT, ENCODING)
        audioTrack = AudioTrack(
            AudioManager.STREAM_MUSIC,
            SAMPLE_RATE,
            CHANNEL_OUT,
            ENCODING,
            bufferSize * 2,
            AudioTrack.MODE_STREAM
        )
        audioTrack?.play()
    }

    private fun playAudio(pcm: ByteArray) {
        try {
            audioTrack?.write(pcm, 0, pcm.size)
        } catch (e: Exception) {
            Log.w(TAG, "Error playing audio", e)
        }
    }

    private fun stopAudioPlayback() {
        try {
            audioTrack?.stop()
            audioTrack?.release()
        } catch (e: Exception) {
            Log.w(TAG, "Error stopping audio track", e)
        }
        audioTrack = null
    }

    private fun updateUI(recording: Boolean, status: String) {
        micButton.alpha = if (recording) 1.0f else 0.6f
        micButton.setColorFilter(
            if (recording) 0xFFFF4444.toInt() else 0xFFFFFFFF.toInt()
        )
        statusText.text = status
        progressBar.visibility = if (recording && !isConnected) View.VISIBLE else View.GONE
    }

    private fun getStoredToken(): String? {
        val prefs = getSharedPreferences("edxo_voice", MODE_PRIVATE)
        return prefs.getString("auth_token", null)
    }

    fun setAuthToken(token: String) {
        getSharedPreferences("edxo_voice", MODE_PRIVATE)
            .edit()
            .putString("auth_token", token)
            .apply()
    }

    @Suppress("DEPRECATION")
    private fun acquireWakeLock() {
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "edxo:voice-session"
        )
        wakeLock?.acquire(10 * 60 * 1000L) // 10 min max
    }

    private fun releaseWakeLock() {
        try {
            if (wakeLock?.isHeld == true) wakeLock?.release()
        } catch (e: Exception) {
            Log.w(TAG, "Error releasing wake lock", e)
        }
        wakeLock = null
    }

    override fun onDestroy() {
        stopSession()
        super.onDestroy()
    }
}
