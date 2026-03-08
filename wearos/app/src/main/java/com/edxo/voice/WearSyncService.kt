package com.edxo.voice

import android.util.Log
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService

/**
 * Receives sync data from the phone (token, workflow, server URL).
 * Also can push config back to the phone when changed on the watch.
 */
class WearSyncService : WearableListenerService() {

    companion object {
        private const val TAG = "WearSync"
        private const val SYNC_PATH = "/edxo-sync"

        /** Push config from watch to phone */
        fun pushConfigToPhone(
            context: android.content.Context,
            token: String? = null,
            refreshToken: String? = null,
            serverUrl: String? = null,
            workflowId: Int? = null,
            workflowName: String? = null
        ) {
            val putDataReq = PutDataMapRequest.create(SYNC_PATH).apply {
                token?.let { dataMap.putString("auth_token", it) }
                refreshToken?.let { dataMap.putString("refresh_token", it) }
                serverUrl?.let { dataMap.putString("server_url", it) }
                workflowId?.let { dataMap.putInt("workflow_id", it) }
                workflowName?.let { dataMap.putString("workflow_name", it) }
                dataMap.putLong("timestamp", System.currentTimeMillis())
            }.asPutDataRequest().setUrgent()

            Wearable.getDataClient(context).putDataItem(putDataReq)
                .addOnSuccessListener { Log.i(TAG, "Config pushed to phone") }
                .addOnFailureListener { Log.w(TAG, "Failed to push config", it) }
        }
    }

    override fun onDataChanged(dataEvents: DataEventBuffer) {
        for (event in dataEvents) {
            if (event.dataItem.uri.path == SYNC_PATH) {
                val dataMap = DataMapItem.fromDataItem(event.dataItem).dataMap
                val prefs = getSharedPreferences("edxo_voice", MODE_PRIVATE).edit()

                if (dataMap.containsKey("auth_token")) {
                    prefs.putString("auth_token", dataMap.getString("auth_token"))
                    Log.i(TAG, "Token synced from phone")
                }
                if (dataMap.containsKey("refresh_token")) {
                    prefs.putString("refresh_token", dataMap.getString("refresh_token"))
                    Log.i(TAG, "Refresh token synced from phone")
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
                Log.i(TAG, "Config synced from phone")
            }
        }
    }
}
