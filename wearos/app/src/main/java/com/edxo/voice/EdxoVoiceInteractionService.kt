package com.edxo.voice

import android.service.voice.VoiceInteractionService
import android.util.Log

/**
 * VoiceInteractionService that registers EDxo Voice as a selectable
 * "Digital Assistant" in Android/Wear OS system settings.
 *
 * Once selected as default, the user can launch EDxo Voice via:
 * - Long-press home/crown button
 * - Swipe gesture (depending on device)
 * - "Digital assistant" shortcut
 */
class EdxoVoiceInteractionService : VoiceInteractionService() {

    companion object {
        private const val TAG = "EdxoVoiceService"
    }

    override fun onReady() {
        super.onReady()
        Log.i(TAG, "EDxo Voice interaction service ready")
    }
}
