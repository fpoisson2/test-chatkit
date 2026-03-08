package com.edxo.voice

import android.content.Context
import android.util.Log
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

object TokenRefresher {

    private const val TAG = "TokenRefresher"

    /**
     * Attempt to refresh the access token using the stored refresh token.
     * Must be called from a background thread.
     * Returns true if the token was refreshed successfully.
     */
    fun refresh(context: Context): Boolean {
        val prefs = context.getSharedPreferences("edxo_voice", Context.MODE_PRIVATE)
        val refreshToken = prefs.getString("refresh_token", null)
        if (refreshToken.isNullOrEmpty()) {
            Log.w(TAG, "No refresh token stored")
            return false
        }

        val baseUrl = prefs.getString("server_base_url", null)
        if (baseUrl.isNullOrEmpty()) {
            // Derive from server_url (wss -> https)
            val wsUrl = prefs.getString("server_url", null) ?: return false
            return refreshWith(context, wsUrl.replace("wss://", "https://").replace("ws://", "http://").replace("/api/voice-relay/ws", ""), refreshToken)
        }
        return refreshWith(context, baseUrl, refreshToken)
    }

    private fun refreshWith(context: Context, baseUrl: String, refreshToken: String): Boolean {
        return try {
            val body = JSONObject().put("refresh_token", refreshToken).toString()
            val request = Request.Builder()
                .url("$baseUrl/api/voice-relay/refresh")
                .post(body.toRequestBody("application/json".toMediaType()))
                .build()

            val response = OkHttpClient().newCall(request).execute()
            val respBody = response.body?.string() ?: ""

            if (response.isSuccessful) {
                val json = JSONObject(respBody)
                val newToken = json.getString("token")
                val newRefresh = json.getString("refresh_token")

                context.getSharedPreferences("edxo_voice", Context.MODE_PRIVATE).edit()
                    .putString("auth_token", newToken)
                    .putString("refresh_token", newRefresh)
                    .apply()

                // Sync to phone
                WearSyncService.pushConfigToPhone(context, token = newToken)

                Log.i(TAG, "Token refreshed successfully")
                true
            } else {
                Log.w(TAG, "Refresh failed: ${response.code}")
                false
            }
        } catch (e: Exception) {
            Log.e(TAG, "Refresh error", e)
            false
        }
    }
}
