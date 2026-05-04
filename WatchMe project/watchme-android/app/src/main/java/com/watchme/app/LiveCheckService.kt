package com.watchme.app

import android.app.Notification
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

class LiveCheckService : Service() {

    private val job = SupervisorJob()
    private val scope = CoroutineScope(Dispatchers.IO + job)
    private var loopJob: Job? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createChannel()
        startForeground(NOTIF_ID, buildNotification())
        loopJob = scope.launch {
            while (isActive) {
                try {
                    val store = TokenStore(this@LiveCheckService)
                    if (!store.fastLiveMonitor) break
                    val token = store.discordAccessToken
                    if (!token.isNullOrBlank()) {
                        WatchMeApi.liveSync(token)
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (_: Exception) {
                    // network errors — retry on next interval
                }
                delay(3 * 60 * 1000L)
            }
            stopSelf()
        }
    }

    override fun onDestroy() {
        loopJob?.cancel()
        job.cancel()
        super.onDestroy()
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val mgr = getSystemService(NotificationManager::class.java) ?: return
        val ch = android.app.NotificationChannel(
            CHANNEL_ID,
            "Live monitoring",
            NotificationManager.IMPORTANCE_LOW
        )
        ch.description =
            "Checks Twitch / Kick / YouTube and pushes through WatchMe while you stream from your phone."
        mgr.createNotificationChannel(ch)
    }

    private fun buildNotification(): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("WatchMe")
            .setContentText("Checking for live streams (every ~3 min)")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setOngoing(true)
            .build()
    }

    companion object {
        private const val CHANNEL_ID = "watchme_live_monitor"
        private const val NOTIF_ID = 71001
    }
}
