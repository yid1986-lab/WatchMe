package com.watchme.app

import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.tasks.await

object PushRegistration {
    internal fun canRegisterPush(
        sessionToken: String?,
        allowPreviewTokens: Boolean = BuildConfig.ALLOW_PREVIEW_TOKENS,
        isApiBaseUrlConfigured: Boolean = BuildConfig.IS_API_BASE_URL_CONFIGURED,
    ): Boolean {
        if (sessionToken.isNullOrBlank()) return false
        if (!allowPreviewTokens && !isApiBaseUrlConfigured) return false
        return true
    }

    suspend fun registerIfAvailable(store: TokenStore, sessionToken: String?) {
        if (!canRegisterPush(sessionToken)) return
        val safeSessionToken = sessionToken ?: return
        val token = runCatching { FirebaseMessaging.getInstance().token.await() }.getOrNull() ?: return
        store.firebasePushToken = token
        runCatching { WatchMeApi.registerPushDevice(safeSessionToken, token) }
    }

    suspend fun unregisterIfAvailable(store: TokenStore, sessionToken: String?) {
        val pushToken = store.firebasePushToken ?: return
        if (sessionToken.isNullOrBlank()) return
        runCatching { WatchMeApi.unregisterPushDevice(sessionToken, pushToken) }
        store.firebasePushToken = null
    }
}
