package com.edxo.voice.mobile

import android.content.Context
import android.util.Log
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable

/**
 * Pushes config (token, server URL, workflow) from phone to watch via Data Layer API.
 */
object WearSyncHelper {

    private const val TAG = "WearSync"
    private const val SYNC_PATH = "/edxo-sync"

    fun pushConfigToWatch(
        context: Context,
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
            .addOnSuccessListener { Log.i(TAG, "Config pushed to watch") }
            .addOnFailureListener { Log.w(TAG, "Failed to push config to watch", it) }
    }
}
