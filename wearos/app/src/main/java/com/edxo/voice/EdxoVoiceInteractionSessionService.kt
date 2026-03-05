package com.edxo.voice

import android.content.Intent
import android.os.Bundle
import android.service.voice.VoiceInteractionSession
import android.service.voice.VoiceInteractionSessionService
import android.util.Log

/**
 * Handles voice interaction sessions triggered by the system
 * (e.g., long-press home button when EDxo is default assistant).
 *
 * Launches MainActivity which handles the actual voice session.
 */
class EdxoVoiceInteractionSessionService : VoiceInteractionSessionService() {

    override fun onNewSession(args: Bundle?): VoiceInteractionSession {
        return EdxoVoiceSession(this)
    }

    private inner class EdxoVoiceSession(
        private val sessionService: EdxoVoiceInteractionSessionService
    ) : VoiceInteractionSession(sessionService) {

        override fun onShow(args: Bundle?, showFlags: Int) {
            super.onShow(args, showFlags)
            Log.i("EdxoVoiceSession", "Voice interaction session started, launching MainActivity")

            val intent = Intent(sessionService, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                putExtra("auto_start", true)
            }
            sessionService.startActivity(intent)

            finish()
        }
    }
}
