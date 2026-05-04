package com.watchme.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class WatchMeMessagingService : FirebaseMessagingService() {
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        val store = TokenStore(this)
        store.firebasePushToken = token
        val sessionToken = store.discordAccessToken
        if (!sessionToken.isNullOrBlank()) {
            scope.launch {
                runCatching { WatchMeApi.registerPushDevice(sessionToken, token) }
            }
        }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        createChannel()
        val title = message.notification?.title
            ?: message.data["title"]
            ?: "WatchMe"
        val body = message.notification?.body
            ?: message.data["body"]
            ?: "Automation update"
        val intent = Intent(this, MainActivity::class.java).apply {
            action = "WATCHME_AUTOMATION_ACTIVITY"
            putExtra("activity_id", message.data["activity_id"])
            addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }
        val pending = PendingIntent.getActivity(
            this,
            72001,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body)
            .setContentIntent(pending)
            .setAutoCancel(true)
            .build()
        getSystemService(NotificationManager::class.java)?.notify(
            (System.currentTimeMillis() % Int.MAX_VALUE).toInt(),
            notification,
        )
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Automation updates",
            NotificationManager.IMPORTANCE_DEFAULT,
        )
        channel.description = "Post status, live detection, and loop prevention updates."
        getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
    }

    companion object {
        private const val CHANNEL_ID = "watchme_automation"
    }
}
