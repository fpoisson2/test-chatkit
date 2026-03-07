package com.edxo.voice.mobile

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.service.voice.VoiceInteractionSession
import android.service.voice.VoiceInteractionSessionService
import android.util.Log

class EdxoVoiceInteractionSessionService : VoiceInteractionSessionService() {

    override fun onNewSession(args: Bundle?): VoiceInteractionSession {
        return EdxoVoiceSession(this)
    }

    private inner class EdxoVoiceSession(
        private val sessionService: EdxoVoiceInteractionSessionService
    ) : VoiceInteractionSession(sessionService) {

        override fun onShow(args: Bundle?, showFlags: Int) {
            super.onShow(args, showFlags)
            Log.i("EdxoVoiceSession", "Voice interaction session started, launching VoiceActivity")

            val intent = Intent(sessionService, VoiceActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            sessionService.startActivity(intent)

            // Defer finish() to avoid BadTokenException — the window token
            // is not yet valid during onShow(), so finishing synchronously crashes.
            Handler(Looper.getMainLooper()).postDelayed({ finish() }, 200)
        }
    }
}
