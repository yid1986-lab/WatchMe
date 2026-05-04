package com.watchme.app

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class LiveSyncWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val store = TokenStore(applicationContext)
        if (store.fastLiveMonitor) return@withContext Result.success()
        val token = store.discordAccessToken
        if (token.isNullOrBlank()) return@withContext Result.success()
        return@withContext try {
            WatchMeApi.liveSync(token)
            Result.success()
        } catch (_: Exception) {
            Result.retry()
        }
    }
}
