package com.edxo.voice

import android.content.Context
import android.util.Log
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.WearableListenerService

/**
 * Receives configuration from the phone app via Data Layer API.
 * The phone pushes: auth token, server URL, workflow ID/name.
 */
class PhoneConfigReceiver : WearableListenerService() {

    companion object {
        private const val TAG = "PhoneConfigReceiver"
        const val CONFIG_PATH = "/edxo-voice-config"
    }

    override fun onDataChanged(dataEvents: DataEventBuffer) {
        for (event in dataEvents) {
            if (event.type == DataEvent.TYPE_CHANGED &&
                event.dataItem.uri.path == CONFIG_PATH
            ) {
                val dataMap = DataMapItem.fromDataItem(event.dataItem).dataMap
                val token = dataMap.getString("auth_token", "")
                val serverUrl = dataMap.getString("server_url", "")
                val workflowId = dataMap.getInt("workflow_id", 0)
                val workflowName = dataMap.getString("workflow_name", "")

                Log.i(TAG, "Received config from phone: url=$serverUrl, workflow=$workflowId ($workflowName)")

                val prefs = getSharedPreferences("edxo_voice", Context.MODE_PRIVATE).edit()
                if (token.isNotEmpty()) prefs.putString("auth_token", token)
                if (serverUrl.isNotEmpty()) prefs.putString("server_url", serverUrl)
                if (workflowId > 0) {
                    prefs.putInt("workflow_id", workflowId)
                    prefs.putString("workflow_name", workflowName)
                }
                prefs.apply()

                Log.i(TAG, "Config saved to SharedPreferences")
            }
        }
    }
}
