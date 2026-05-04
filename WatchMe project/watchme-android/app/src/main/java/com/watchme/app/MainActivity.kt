package com.watchme.app

import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    companion object {
        private const val PreviewSessionTokenExtra = "preview_session_token"
        private const val DiscordMobileRedirectScheme = "discord-1477424100304752671"
        private const val LegacyRedirectScheme = "watchme"
        private const val LegacyRedirectHost = "oauth"
        private const val DiscordMobileRedirectHost = "authorize"
        private const val DiscordMobileRedirectPath = "/callback"
        private const val DiscordMobilePathOnlyRedirect = "/authorize/callback"
    }

    private lateinit var store: TokenStore
    private val discordAuthLauncher: DiscordAuthLauncher = StandardDiscordOAuthLauncher
    private var pendingPkceState: String? = null
    private val accessTokenState = mutableStateOf<String?>(null)
    private val statusMessageState = mutableStateOf<String?>(null)

    private fun clearPendingDiscordAuthState() {
        WatchMeApi.clearPendingDiscordAuth(pendingPkceState)
        pendingPkceState = null
        store.pendingDiscordAuthState = null
        store.pendingDiscordRedirectUri = null
        store.pendingDiscordVerifier = null
    }

    private fun applyToken(token: String?) {
        store.discordAccessToken = token
        accessTokenState.value = token
        if (token == null) {
            store.backgroundLiveMonitor = false
            store.fastLiveMonitor = false
        } else {
            lifecycleScope.launch {
                PushRegistration.registerIfAvailable(store, token)
            }
        }
        LiveMonitorScheduler.applyModes(this, store)
    }

    private fun openStandardDiscordOAuth(url: String) {
        discordAuthLauncher.launchAuthorization(
            activity = this,
            authorizationUrl = url,
            onLaunchFailure = { message ->
                clearPendingDiscordAuthState()
                statusMessageState.value = message
            },
        )
    }

    private fun consumeOAuthUri(uri: Uri?) {
        if (uri == null) return
        val isLegacyRedirect =
            uri.scheme == LegacyRedirectScheme && uri.host == LegacyRedirectHost
        val isDiscordMobileRedirect =
            uri.scheme == DiscordMobileRedirectScheme &&
                (
                    (uri.host == DiscordMobileRedirectHost && uri.path == DiscordMobileRedirectPath) ||
                        (uri.host.isNullOrEmpty() && uri.path == DiscordMobilePathOnlyRedirect)
                )
        if (!isLegacyRedirect && !isDiscordMobileRedirect) return
        val code = uri.getQueryParameter("code") ?: return
        val state = uri.getQueryParameter("state") ?: return
        if (pendingPkceState != null && state != pendingPkceState) {
            WatchMeApi.clearPendingDiscordAuth(state)
            return
        }

        lifecycleScope.launch {
            try {
                val access = WatchMeApi.exchangeDiscordCode(
                    code = code,
                    state = state,
                    redirectUri = store.pendingDiscordRedirectUri,
                    verifier = store.pendingDiscordVerifier,
                )
                clearPendingDiscordAuthState()
                statusMessageState.value = null
                applyToken(access)
            } catch (e: Exception) {
                clearPendingDiscordAuthState()
                statusMessageState.value = e.message ?: "Discord sign-in could not be completed."
            }
        }
    }

    private fun previewSessionToken(intent: Intent?): String? {
        if (!BuildConfig.ALLOW_PREVIEW_TOKENS) return null
        return intent
            ?.getStringExtra(PreviewSessionTokenExtra)
            ?.trim()
            ?.takeIf { it.isNotEmpty() }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
        )
        store = TokenStore(this)
        pendingPkceState = store.pendingDiscordAuthState
        accessTokenState.value = store.discordAccessToken ?: previewSessionToken(intent)
        LiveMonitorScheduler.applyModes(this, store)
        consumeOAuthUri(intent?.data)

        setContent {
            val token by accessTokenState
            WatchMeTheme {
                WatchMeApp(
                    token = token,
                    statusMessage = statusMessageState,
                    onOpenDiscordLogin = { url, state ->
                        WatchMeApi.getPendingDiscordAuth(state)?.let { pending ->
                            store.pendingDiscordAuthState = state
                            store.pendingDiscordRedirectUri = pending.redirectUri
                            store.pendingDiscordVerifier = pending.verifier
                        }
                        pendingPkceState = state
                        statusMessageState.value = "Continue Discord sign-in to return to WatchMe Pro."
                        openStandardDiscordOAuth(url)
                    },
                    onLogout = {
                        val currentToken = store.discordAccessToken
                        lifecycleScope.launch {
                            PushRegistration.unregisterIfAvailable(store, currentToken)
                        }
                        applyToken(null)
                    },
                    onSaveProfile = { display, tw, yt, k ->
                        val currentToken = token ?: throw IllegalStateException("Not logged in")
                        WatchMeApi.saveProfile(currentToken, display, tw, yt, k)
                    },
                    onLoadProfile = {
                        val currentToken = token ?: throw IllegalStateException("Not logged in")
                        WatchMeApi.getProfile(currentToken)
                    },
                    onLiveSync = {
                        val currentToken = token ?: throw IllegalStateException("Not logged in")
                        WatchMeApi.liveSync(currentToken)
                    },
                    onLoadLiveStatus = {
                        val currentToken = token ?: throw IllegalStateException("Not logged in")
                        WatchMeApi.liveStatus(currentToken)
                    },
                    onLoadCreatorPostBuilder = { creatorId ->
                        val currentToken = token ?: throw IllegalStateException("Not logged in")
                        WatchMeApi.getCreatorPostBuilder(currentToken, creatorId)
                    },
                    onLoadGuildWorkspace = { guildId ->
                        val currentToken = token ?: throw IllegalStateException("Not logged in")
                        WatchMeApi.getGuildWorkspace(currentToken, guildId)
                    },
                    onLoadGuildChannels = { guildId ->
                        val currentToken = token ?: throw IllegalStateException("Not logged in")
                        WatchMeApi.getGuildChannels(currentToken, guildId)
                    },
                    onLoadGuildMembers = { guildId ->
                        val currentToken = token ?: throw IllegalStateException("Not logged in")
                        WatchMeApi.getGuildMembers(currentToken, guildId)
                    },
                    onLoadGuildRoles = { guildId ->
                        val currentToken = token ?: throw IllegalStateException("Not logged in")
                        WatchMeApi.getGuildRoles(currentToken, guildId)
                    },
                    onSaveGuildConfig = { guildId, config ->
                        val currentToken = token ?: throw IllegalStateException("Not logged in")
                        WatchMeApi.saveGuildConfig(currentToken, guildId, config)
                    },
                    onAddGuildKeywordFilter = { guildId, platform, keyword ->
                        val currentToken = token ?: throw IllegalStateException("Not logged in")
                        WatchMeApi.addGuildKeywordFilter(currentToken, guildId, platform, keyword)
                    },
                    onRemoveGuildKeywordFilter = { guildId, platform, keyword ->
                        val currentToken = token ?: throw IllegalStateException("Not logged in")
                        WatchMeApi.removeGuildKeywordFilter(currentToken, guildId, platform, keyword)
                    },
                    onSaveCreatorTemplate = { creatorId, template ->
                        val currentToken = token ?: throw IllegalStateException("Not logged in")
                        WatchMeApi.saveCreatorPostTemplate(currentToken, creatorId, template)
                    },
                    onSaveCreatorConnection = { creatorId, connection ->
                        val currentToken = token ?: throw IllegalStateException("Not logged in")
                        WatchMeApi.saveCreatorSocialConnection(currentToken, creatorId, connection)
                    },
                    onPublishCreatorPost = { creatorId, template, scheduledAt ->
                        val currentToken = token ?: throw IllegalStateException("Not logged in")
                        WatchMeApi.publishCreatorPost(currentToken, creatorId, template, scheduledAt)
                    },
                    onLoadAutomationHome = {
                        val currentToken = token ?: throw IllegalStateException("Not logged in")
                        WatchMeApi.automationHome(currentToken)
                    },
                    onLoadAutomationActivity = {
                        val currentToken = token ?: throw IllegalStateException("Not logged in")
                        WatchMeApi.automationActivity(currentToken)
                    },
                    onLoadScheduledPosts = { creatorId ->
                        val currentToken = token ?: throw IllegalStateException("Not logged in")
                        WatchMeApi.scheduledCreatorPosts(currentToken, creatorId)
                    },
                    onRepostDispatch = { dispatchId ->
                        val currentToken = token ?: throw IllegalStateException("Not logged in")
                        WatchMeApi.repostDispatch(currentToken, dispatchId)
                    },
                    store = store,
                    activity = this@MainActivity,
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        consumeOAuthUri(intent?.data)
        if (store.discordAccessToken == null) {
            previewSessionToken(intent)?.let { accessTokenState.value = it }
        }
    }
}
