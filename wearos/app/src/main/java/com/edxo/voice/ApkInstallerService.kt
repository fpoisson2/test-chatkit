package com.edxo.voice

import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.util.Log
import androidx.core.content.FileProvider
import com.google.android.gms.wearable.ChannelClient
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService
import java.io.File

/**
 * Receives the watch APK from the phone companion app via Channel API
 * and triggers installation.
 */
class ApkInstallerService : WearableListenerService() {

    companion object {
        private const val TAG = "ApkInstaller"
        private const val APK_CHANNEL_PATH = "/edxo-voice-apk"
        private const val APK_FILENAME = "edxo-voice-update.apk"
    }

    override fun onChannelOpened(channel: ChannelClient.Channel) {
        if (channel.path != APK_CHANNEL_PATH) return

        Log.i(TAG, "Receiving APK from phone...")

        val apkFile = File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), APK_FILENAME)

        val channelClient = Wearable.getChannelClient(this)
        channelClient.receiveFile(channel, Uri.fromFile(apkFile), false)
            .addOnSuccessListener {
                Log.i(TAG, "APK received: ${apkFile.length()} bytes")
                channelClient.close(channel)
                installApk(apkFile)
            }
            .addOnFailureListener { e ->
                Log.e(TAG, "Failed to receive APK", e)
                channelClient.close(channel)
            }
    }

    private fun installApk(apkFile: File) {
        try {
            val uri = FileProvider.getUriForFile(
                this,
                "${packageName}.fileprovider",
                apkFile
            )

            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }

            startActivity(intent)
            Log.i(TAG, "Install intent launched")
        } catch (e: Exception) {
            // Fallback: try with ACTION_INSTALL_PACKAGE
            try {
                val uri = FileProvider.getUriForFile(
                    this,
                    "${packageName}.fileprovider",
                    apkFile
                )
                val intent = Intent(Intent.ACTION_INSTALL_PACKAGE).apply {
                    data = uri
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    putExtra(Intent.EXTRA_NOT_UNKNOWN_SOURCE, true)
                }
                startActivity(intent)
            } catch (e2: Exception) {
                Log.e(TAG, "Failed to launch installer", e2)
            }
        }
    }
}
