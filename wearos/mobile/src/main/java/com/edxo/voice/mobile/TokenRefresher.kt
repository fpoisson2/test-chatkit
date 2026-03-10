package com.edxo.voice.mobile

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
     * Refresh the token only if it's expiring within 5 minutes.
     * Must be called from a background thread.
     * Returns true if a refresh was performed successfully, false if not needed or failed.
     */
    fun refreshIfNeeded(context: Context): Boolean {
        val token = context.getSharedPreferences("edxo_voice", Context.MODE_PRIVATE)
            .getString("auth_token", null) ?: return false
        if (JwtHelper.isExpiringSoon(token) || JwtHelper.isExpired(token)) {
            Log.i(TAG, "Token expiring soon, refreshing proactively")
            return refresh(context)
        }
        return false
    }

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

                // Sync both tokens to watch so it doesn't use the old (now-invalid) refresh token
                WearSyncHelper.pushConfigToWatch(context, token = newToken, refreshToken = newRefresh)

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
