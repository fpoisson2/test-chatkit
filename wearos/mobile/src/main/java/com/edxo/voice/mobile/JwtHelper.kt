package com.edxo.voice.mobile

import android.util.Base64
import android.util.Log
import org.json.JSONObject

/**
 * Lightweight JWT payload decoder for checking token expiration client-side.
 * Does NOT verify signatures — that is the server's responsibility.
 */
object JwtHelper {

    private const val TAG = "JwtHelper"

    /** Returns seconds until expiration, or -1 if unparseable. */
    fun secondsUntilExpiry(jwt: String): Long {
        return try {
            val parts = jwt.split(".")
            if (parts.size != 3) return -1
            val payload = String(
                Base64.decode(parts[1], Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
            )
            val exp = JSONObject(payload).optLong("exp", 0)
            if (exp == 0L) return -1
            exp - (System.currentTimeMillis() / 1000)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to decode JWT", e)
            -1
        }
    }

    /** Returns true if the token expires within [thresholdSeconds] (default 5 min). */
    fun isExpiringSoon(jwt: String, thresholdSeconds: Long = 300): Boolean {
        val remaining = secondsUntilExpiry(jwt)
        return remaining in 0..thresholdSeconds
    }

    /** Returns true if the token is already expired. */
    fun isExpired(jwt: String): Boolean {
        val remaining = secondsUntilExpiry(jwt)
        return remaining != -1L && remaining <= 0
    }
}
