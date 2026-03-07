package com.edxo.voice.mobile

import android.service.voice.VoiceInteractionService
import android.util.Log

class EdxoVoiceInteractionService : VoiceInteractionService() {

    override fun onReady() {
        super.onReady()
        Log.i("EdxoVoiceService", "EDxo Voice interaction service ready")
    }
}
