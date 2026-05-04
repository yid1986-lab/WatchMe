package com.watchme.app

import android.content.Context
import android.content.Intent
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

object LiveMonitorScheduler {

    private const val WORK_NAME = "watchme_live_sync"

    fun applyModes(context: Context, store: TokenStore) {
        val token = store.discordAccessToken
        if (token.isNullOrBlank()) {
            cancelWork(context)
            stopFastService(context)
            store.backgroundLiveMonitor = false
            store.fastLiveMonitor = false
            return
        }

        when {
            store.fastLiveMonitor -> {
                cancelWork(context)
                startFastService(context)
            }
            store.backgroundLiveMonitor -> {
                stopFastService(context)
                schedulePeriodic(context)
            }
            else -> {
                cancelWork(context)
                stopFastService(context)
            }
        }
    }

    private fun schedulePeriodic(context: Context) {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()
        val request = PeriodicWorkRequestBuilder<LiveSyncWorker>(15, TimeUnit.MINUTES)
            .setConstraints(constraints)
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            WORK_NAME,
            ExistingPeriodicWorkPolicy.KEEP,
            request
        )
    }

    private fun cancelWork(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
    }

    private fun startFastService(context: Context) {
        val i = Intent(context, LiveCheckService::class.java)
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            context.startForegroundService(i)
        } else {
            @Suppress("DEPRECATION")
            context.startService(i)
        }
    }

    private fun stopFastService(context: Context) {
        context.stopService(Intent(context, LiveCheckService::class.java))
    }
}
