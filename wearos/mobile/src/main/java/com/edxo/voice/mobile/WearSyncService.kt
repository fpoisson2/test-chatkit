package com.edxo.voice.mobile

import android.content.Intent
import android.util.Log
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService

/**
 * Receives sync data from the watch (e.g., workflow changes made on watch).
 * Also receives messages (e.g., request to open app for login).
 */
class WearSyncService : WearableListenerService() {

    companion object {
        private const val TAG = "WearSyncService"
    }

    override fun onMessageReceived(messageEvent: MessageEvent) {
        if (messageEvent.path == "/edxo-open-app") {
            Log.i(TAG, "Watch requested to open app")
            val intent = Intent(this, LoginActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(intent)
        }
    }

    override fun onDataChanged(dataEvents: DataEventBuffer) {
        for (event in dataEvents) {
            if (event.dataItem.uri.path == "/edxo-sync") {
                val dataMap = DataMapItem.fromDataItem(event.dataItem).dataMap
                val prefs = getSharedPreferences("edxo_voice", MODE_PRIVATE).edit()

                if (dataMap.containsKey("auth_token")) {
                    prefs.putString("auth_token", dataMap.getString("auth_token"))
                    Log.i(TAG, "Token synced from watch")
                }
                if (dataMap.containsKey("server_url")) {
                    prefs.putString("server_url", dataMap.getString("server_url"))
                }
                if (dataMap.containsKey("workflow_id")) {
                    prefs.putInt("workflow_id", dataMap.getInt("workflow_id"))
                }
                if (dataMap.containsKey("workflow_name")) {
                    prefs.putString("workflow_name", dataMap.getString("workflow_name"))
                }

                prefs.apply()
            }
        }
    }
}
