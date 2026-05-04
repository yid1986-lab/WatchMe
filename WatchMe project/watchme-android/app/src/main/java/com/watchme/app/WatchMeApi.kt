package com.watchme.app

import okhttp3.FormBody
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

object WatchMeApi {

    private const val PreviewProToken = "preview-pro"
    private const val PreviewLiteToken = "preview-lite"
    private const val PreviewLiteDiscordInviteUrl = "https://discord.com/invite/watchme"
    private const val DiscordClientId = "1477424100304752671"
    private const val MissingBaseUrlMessage =
        "Set WATCHME_DEBUG_API_BASE_URL or WATCHME_API_BASE_URL before using the live backend."

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    private val jsonMedia = "application/json; charset=utf-8".toMediaType()
    private val pendingDiscordAuth = ConcurrentHashMap<String, PendingDiscordAuth>()

    data class PendingDiscordAuth(
        val redirectUri: String,
        val verifier: String,
    )

    private fun base(): String {
        if (!BuildConfig.IS_API_BASE_URL_CONFIGURED) {
            throw IllegalStateException(MissingBaseUrlMessage)
        }
        return BuildConfig.API_BASE_URL
    }

    private fun toBase64Url(bytes: ByteArray): String {
        return android.util.Base64.encodeToString(
            bytes,
            android.util.Base64.URL_SAFE or
                android.util.Base64.NO_WRAP or
                android.util.Base64.NO_PADDING,
        )
    }

    fun clearPendingDiscordAuth(state: String?) {
        if (state == null) return
        pendingDiscordAuth.remove(state)
    }

    fun getPendingDiscordAuth(state: String?): PendingDiscordAuth? {
        if (state == null) return null
        return pendingDiscordAuth[state]
    }

    internal fun shouldTreatAsPreviewToken(
        token: String,
        allowPreviewTokens: Boolean = BuildConfig.ALLOW_PREVIEW_TOKENS,
    ): Boolean {
        return allowPreviewTokens &&
            (token == PreviewProToken || token == PreviewLiteToken)
    }

    private fun isPreviewToken(token: String): Boolean {
        return shouldTreatAsPreviewToken(token)
    }

    private fun previewProfile(token: String): JSONObject? {
        if (!isPreviewToken(token)) return null
        val isPro = token == PreviewProToken
        val displayName = if (isPro) "Alex Rivers" else "Alex Lite"
        val username = if (isPro) "alex.watchme.pro" else "alex.watchme.lite"
        return JSONObject()
            .put("display_name", displayName)
            .put("discord_username", username)
            .put("discord_user_id", "483920193148392019")
            .put("twitch_url", "https://www.twitch.tv/$username")
            .put("youtube_url", "https://www.youtube.com/@watchmepro")
            .put("kick_url", "https://kick.com/$username")
            .put("verified_pro", isPro)
            .put("membership", JSONObject()
                .put("plan", if (isPro) "WatchMe Pro" else "WatchMe Lite")
                .put("status", if (isPro) "active" else "lite")
            )
            .put(
                "roles",
                JSONArray().put(if (isPro) "Verified Pro Member" else "WatchMe Lite"),
            )
            .put(
                "guilds",
                JSONArray()
                    .put(JSONObject().put("id", "9842001001").put("name", "WatchMe Pro HQ"))
                    .put(JSONObject().put("id", "9842001002").put("name", "Alex Creator Hub"))
                    .put(JSONObject().put("id", "9842001003").put("name", "Night Stream Crew")),
            )
            .put("lite_discord_invite_url", PreviewLiteDiscordInviteUrl)
            .put(
                "identity",
                JSONObject()
                    .put("display_name", displayName)
                    .put("discord_username", username)
                    .put("discord_user_id", "483920193148392019"),
            )
    }

    private fun previewLiveStatus(token: String): JSONObject? {
        if (!isPreviewToken(token)) return null
        val isPro = token == PreviewProToken
        return JSONObject()
            .put("is_live", isPro)
            .put("platform", if (isPro) "Twitch" else "Discord")
            .put(
                "title",
                if (isPro) "Tonight's creator alerts are armed"
                else "Lite access connected, waiting for Pro unlock",
            )
            .put("checked_at", "just now")
    }

    private fun previewPostBuilder(token: String, creatorId: String): JSONObject? {
        if (!isPreviewToken(token)) return null
        return JSONObject()
            .put(
                "templates",
                JSONArray()
                    .put(
                        JSONObject()
                            .put("template_id", 9001)
                            .put("name", "Live alert")
                            .put("post_text", "We are live. Drop in and let the guild know the stream just started.")
                            .put("link_url", "https://watchme.example/live/$creatorId")
                            .put("media_urls_json", JSONArray())
                            .put("target_platforms_json", JSONArray().put("twitch").put("youtube"))
                            .put("is_default", true),
                    )
                    .put(
                        JSONObject()
                            .put("template_id", 9002)
                            .put("name", "New upload push")
                            .put("post_text", "Fresh content is up. Push it across socials and the Discord feed.")
                            .put("link_url", "https://watchme.example/upload/$creatorId")
                            .put("media_urls_json", JSONArray())
                            .put("target_platforms_json", JSONArray().put("facebook").put("youtube"))
                            .put("is_default", false),
                    ),
            )
            .put(
                "connections",
                JSONArray()
                    .put(
                        JSONObject()
                            .put("platform", "youtube")
                            .put("external_account_id", "UC-WATCHME-PRO")
                            .put("external_account_name", "WatchMe Pro")
                            .put("status", "connected")
                            .put("token_expires_at", "2026-12-31")
                            .put("metadata_json", JSONObject().put("notes", "Primary upload route")),
                    )
                    .put(
                        JSONObject()
                            .put("platform", "facebook")
                            .put("external_account_id", "watchme.pro.page")
                            .put("external_account_name", "WatchMe Pro Facebook")
                            .put("status", "connected")
                            .put("token_expires_at", "2026-12-31")
                            .put("metadata_json", JSONObject().put("notes", "Cross-posting active")),
                    ),
            )
    }

    private fun previewAutomationHome(token: String): JSONObject? {
        if (!isPreviewToken(token)) return null
        return JSONObject()
            .put("ok", true)
            .put("summary", JSONObject()
                .put("creators_live", if (token == PreviewProToken) 2 else 0)
                .put("posts_today", 6)
                .put("success_rate", 92)
                .put("top_platform", "facebook")
                .put("scheduled_count", 3)
                .put("needs_attention", 1)
            )
            .put("health", JSONObject()
                .put("push_configured", true)
                .put("active_push_devices", 1)
                .put("connected_platforms", 2)
                .put("total_platforms", 3)
            )
            .put("recent_activity", JSONArray()
                .put(JSONObject()
                    .put("activity_id", 1)
                    .put("event_type", "live.detected")
                    .put("title", "Alex Rivers just went live")
                    .put("body", "Alex Rivers is live on Twitch.")
                    .put("severity", "info")
                    .put("platform", "twitch")
                    .put("created_at", "just now")
                )
                .put(JSONObject()
                    .put("activity_id", 2)
                    .put("event_type", "post.sent")
                    .put("title", "Post sent")
                    .put("body", "Posted to 2 platforms.")
                    .put("severity", "info")
                    .put("platform", "facebook")
                    .put("created_at", "2 min ago")
                )
                .put(JSONObject()
                    .put("activity_id", 3)
                    .put("event_type", "loop.prevented")
                    .put("title", "Loop prevented")
                    .put("body", "WatchMe-generated post ignored.")
                    .put("severity", "info")
                    .put("platform", "instagram")
                    .put("created_at", "7 min ago")
                )
            )
            .put("scheduled", JSONArray()
                .put(JSONObject()
                    .put("dispatch_id", 88021)
                    .put("status", "scheduled")
                    .put("scheduled_at", "2026-05-01T18:30:00.000Z")
                    .put("payload_json", JSONObject()
                        .put("template_name", "Tonight reminder")
                        .put("post_text", "Tonight's stream is lined up.")
                    )
                    .put("target_platforms_json", JSONArray().put("facebook").put("instagram"))
                )
            )
    }

    private fun previewTemplateResponse(template: CreatorPostTemplate): JSONObject {
        return JSONObject().put(
            "template",
            template.toApiJson()
                .put("template_id", template.remoteTemplateId ?: 9900L)
                .put("local_id", template.localId),
        )
    }

    private fun previewConnectionResponse(connection: CreatorSocialConnection): JSONObject {
        val meta = JSONObject().put("notes", connection.notes)
        if (connection.avatarUrl.isNotBlank()) {
            meta.put("avatar_url", connection.avatarUrl)
        }
        return JSONObject().put(
            "connection",
            JSONObject()
                .put("platform", connection.platform)
                .put("external_account_id", connection.externalAccountId)
                .put("external_account_name", connection.externalAccountName)
                .put("status", connection.status)
                .put("token_expires_at", connection.tokenExpiresAt)
                .put("metadata_json", meta),
        )
    }

    private fun previewDispatchResponse(template: CreatorPostTemplate): JSONObject {
        val payload = JSONObject()
            .put("template_name", template.name)
            .put("post_text", template.postText)
            .put("link_url", if (template.linkUrl.isBlank()) JSONObject.NULL else template.linkUrl)
            .put("media_urls_json", JSONArray(template.mediaUris))
        return JSONObject().put(
            "dispatch",
            JSONObject()
                .put("dispatch_id", 88001)
                .put("status", "queued")
                .put("payload_json", payload)
                .put("target_platforms_json", JSONArray(template.targetPlatforms)),
        )
    }

    suspend fun startDiscordAuth(): Pair<String, String> = withContext(Dispatchers.IO) {
        val state = toBase64Url(SecureRandom().generateSeed(24))
        val verifier = toBase64Url(SecureRandom().generateSeed(32))
        val challenge = toBase64Url(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray()))
        val redirectUri = "discord-$DiscordClientId:/authorize/callback"
        pendingDiscordAuth[state] = PendingDiscordAuth(
            redirectUri = redirectUri,
            verifier = verifier,
        )

        val url = okhttp3.HttpUrl.Builder()
            .scheme("https")
            .host("discord.com")
            .addPathSegment("oauth2")
            .addPathSegment("authorize")
            .addQueryParameter("client_id", DiscordClientId)
            .addQueryParameter("redirect_uri", redirectUri)
            .addQueryParameter("response_type", "code")
            .addQueryParameter("scope", "identify guilds")
            .addQueryParameter("state", state)
            .addQueryParameter("code_challenge", challenge)
            .addQueryParameter("code_challenge_method", "S256")
            .build()
            .toString()

        url to state
    }

    suspend fun exchangeDiscordCode(
        code: String,
        state: String,
        redirectUri: String? = null,
        verifier: String? = null,
    ): String = withContext(Dispatchers.IO) {
        val pending = pendingDiscordAuth.remove(state)
        val effectiveRedirectUri = redirectUri ?: pending?.redirectUri
        val effectiveVerifier = verifier ?: pending?.verifier
        if (!effectiveRedirectUri.isNullOrBlank() && !effectiveVerifier.isNullOrBlank()) {
            val body = FormBody.Builder()
                .add("client_id", DiscordClientId)
                .add("grant_type", "authorization_code")
                .add("code", code)
                .add("redirect_uri", effectiveRedirectUri)
                .add("code_verifier", effectiveVerifier)
                .build()
            val req = Request.Builder()
                .url("https://discord.com/api/oauth2/token")
                .post(body)
                .build()
            client.newCall(req).execute().use { res ->
                val payload = res.body?.string().orEmpty()
                if (!res.isSuccessful) throw IllegalStateException("discord exchange ${res.code}: $payload")
                val discordAccessToken = JSONObject(payload).getString("access_token")
                return@withContext issueMobileSession(discordAccessToken)
            }
        }

        val payload = JSONObject()
            .put("code", code)
            .put("state", state)
            .toString()
        val req = Request.Builder()
            .url("${base()}/api/mobile/discord/exchange")
            .post(payload.toRequestBody(jsonMedia))
            .build()
        client.newCall(req).execute().use { res ->
            val body = res.body?.string().orEmpty()
            if (!res.isSuccessful) throw IllegalStateException("exchange ${res.code}: $body")
            val json = JSONObject(body)
            json.optJSONObject("session")?.optString("token")?.takeIf { it.isNotBlank() }
                ?: json.optString("access_token").takeIf { it.isNotBlank() }
                ?: throw IllegalStateException("exchange response did not include a session token")
        }
    }

    private suspend fun issueMobileSession(discordAccessToken: String): String {
        val payload = JSONObject()
            .put("access_token", discordAccessToken)
            .toString()
        val req = Request.Builder()
            .url("${base()}/api/mobile/discord/session")
            .post(payload.toRequestBody(jsonMedia))
            .build()
        client.newCall(req).execute().use { res ->
            val body = res.body?.string().orEmpty()
            if (!res.isSuccessful) throw IllegalStateException("mobile session ${res.code}: $body")
            return JSONObject(body)
                .getJSONObject("session")
                .getString("token")
        }
    }

    suspend fun getProfile(token: String): JSONObject = withContext(Dispatchers.IO) {
        previewProfile(token)?.let { return@withContext it }
        val req = Request.Builder()
            .url("${base()}/api/mobile/profile")
            .header("Authorization", "Bearer $token")
            .get()
            .build()
        client.newCall(req).execute().use { res ->
            val body = res.body?.string().orEmpty()
            if (!res.isSuccessful) throw IllegalStateException("profile GET ${res.code}: $body")
            JSONObject(body)
        }
    }

    suspend fun liveStatus(token: String): JSONObject = withContext(Dispatchers.IO) {
        previewLiveStatus(token)?.let { return@withContext it }
        val req = Request.Builder()
            .url("${base()}/api/me/live-status")
            .header("Authorization", "Bearer $token")
            .get()
            .build()
        client.newCall(req).execute().use { res ->
            val body = res.body?.string().orEmpty()
            if (!res.isSuccessful) throw IllegalStateException("live-status ${res.code}: $body")
            JSONObject(body)
        }
    }

    suspend fun liveSync(token: String): JSONObject = withContext(Dispatchers.IO) {
        previewLiveStatus(token)?.let {
            return@withContext JSONObject()
                .put("ok", true)
                .put("message", "Preview live sync completed.")
                .put("status", it)
        }
        val req = Request.Builder()
            .url("${base()}/api/me/live-sync")
            .header("Authorization", "Bearer $token")
            .post("{}".toRequestBody(jsonMedia))
            .build()
        client.newCall(req).execute().use { res ->
            val body = res.body?.string().orEmpty()
            if (!res.isSuccessful) throw IllegalStateException("live-sync ${res.code}: $body")
            JSONObject(body)
        }
    }

    suspend fun saveProfile(
        token: String,
        displayName: String?,
        twitchUrl: String?,
        youtubeUrl: String?,
        kickUrl: String?
    ): JSONObject = withContext(Dispatchers.IO) {
        previewProfile(token)?.let { preview ->
            if (!displayName.isNullOrBlank()) preview.put("display_name", displayName)
            if (!twitchUrl.isNullOrBlank()) preview.put("twitch_url", twitchUrl)
            if (!youtubeUrl.isNullOrBlank()) preview.put("youtube_url", youtubeUrl)
            if (!kickUrl.isNullOrBlank()) preview.put("kick_url", kickUrl)
            return@withContext preview
        }
        val o = JSONObject()
        fun putOpt(key: String, value: String?) {
            if (value.isNullOrBlank()) o.put(key, JSONObject.NULL)
            else o.put(key, value)
        }
        putOpt("display_name", displayName)
        putOpt("twitch_url", twitchUrl)
        putOpt("youtube_url", youtubeUrl)
        putOpt("kick_url", kickUrl)
        val req = Request.Builder()
            .url("${base()}/api/mobile/profile")
            .header("Authorization", "Bearer $token")
            .put(o.toString().toRequestBody(jsonMedia))
            .build()
        client.newCall(req).execute().use { res ->
            val body = res.body?.string().orEmpty()
            if (!res.isSuccessful) throw IllegalStateException("profile PUT ${res.code}: $body")
            JSONObject(body).optJSONObject("profile") ?: JSONObject(body)
        }
    }

    suspend fun getCreatorPostBuilder(
        sessionToken: String,
        creatorId: String,
    ): JSONObject = withContext(Dispatchers.IO) {
        previewPostBuilder(sessionToken, creatorId)?.let { return@withContext it }
        val req = Request.Builder()
            .url("${base()}/api/mobile/creators/$creatorId/post-builder")
            .header("Authorization", "Bearer $sessionToken")
            .get()
            .build()
        client.newCall(req).execute().use { res ->
            val body = res.body?.string().orEmpty()
            if (!res.isSuccessful) {
                throw IllegalStateException("post-builder GET ${res.code}: $body")
            }
            JSONObject(body)
        }
    }

    suspend fun getGuildWorkspace(sessionToken: String, guildId: String): JSONObject = withContext(Dispatchers.IO) {
        val req = Request.Builder()
            .url("${base()}/api/mobile/guilds/$guildId/workspace")
            .header("Authorization", "Bearer $sessionToken")
            .get()
            .build()
        client.newCall(req).execute().use { res ->
            val body = res.body?.string().orEmpty()
            if (!res.isSuccessful) throw IllegalStateException("workspace ${res.code}: $body")
            JSONObject(body)
        }
    }

    suspend fun saveGuildConfig(
        sessionToken: String,
        guildId: String,
        config: JSONObject,
    ): JSONObject = withContext(Dispatchers.IO) {
        val req = Request.Builder()
            .url("${base()}/api/mobile/guilds/$guildId/config")
            .header("Authorization", "Bearer $sessionToken")
            .put(config.toString().toRequestBody(jsonMedia))
            .build()
        client.newCall(req).execute().use { res ->
            val body = res.body?.string().orEmpty()
            if (!res.isSuccessful) throw IllegalStateException("guild config ${res.code}: $body")
            JSONObject(body)
        }
    }

    suspend fun getGuildChannels(sessionToken: String, guildId: String): JSONObject = withContext(Dispatchers.IO) {
        if (isPreviewToken(sessionToken)) {
            return@withContext JSONObject()
                .put("ok", true)
                .put("guild_id", guildId)
                .put(
                    "channels",
                    JSONArray()
                        .put(JSONObject().put("id", "preview-announce").put("name", "live-alerts").put("type", 0))
                        .put(JSONObject().put("id", "preview-live").put("name", "going-live").put("type", 0))
                        .put(JSONObject().put("id", "preview-social").put("name", "social-feed").put("type", 5)),
                )
        }
        val req = Request.Builder()
            .url("${base()}/api/mobile/guilds/$guildId/channels")
            .header("Authorization", "Bearer $sessionToken")
            .get()
            .build()
        client.newCall(req).execute().use { res ->
            val body = res.body?.string().orEmpty()
            if (!res.isSuccessful) throw IllegalStateException("guild channels ${res.code}: $body")
            JSONObject(body)
        }
    }

    suspend fun getGuildMembers(sessionToken: String, guildId: String): JSONObject = withContext(Dispatchers.IO) {
        if (isPreviewToken(sessionToken)) {
            return@withContext JSONObject()
                .put("ok", true)
                .put("guild_id", guildId)
                .put(
                    "members",
                    JSONArray()
                        .put(
                            JSONObject()
                                .put("discord_user_id", "preview-user-1")
                                .put("display_name", "Preview Creator One")
                                .put("nickname", "")
                                .put("avatar_url", ""),
                        )
                        .put(
                            JSONObject()
                                .put("discord_user_id", "preview-user-2")
                                .put("display_name", "Preview_Mod_Two")
                                .put("nickname", "ModTwo")
                                .put("avatar_url", ""),
                        ),
                )
        }
        val req = Request.Builder()
            .url("${base()}/api/mobile/guilds/$guildId/members")
            .header("Authorization", "Bearer $sessionToken")
            .get()
            .build()
        client.newCall(req).execute().use { res ->
            val body = res.body?.string().orEmpty()
            if (!res.isSuccessful) throw IllegalStateException("guild members ${res.code}: $body")
            JSONObject(body)
        }
    }

    suspend fun getGuildRoles(sessionToken: String, guildId: String): JSONObject = withContext(Dispatchers.IO) {
        if (isPreviewToken(sessionToken)) {
            return@withContext JSONObject()
                .put("ok", true)
                .put("guild_id", guildId)
                .put(
                    "roles",
                    JSONArray()
                        .put(JSONObject().put("id", "preview-role-live").put("name", "Live Now"))
                        .put(JSONObject().put("id", "preview-role-crew").put("name", "Creator Crew")),
                )
        }
        val req = Request.Builder()
            .url("${base()}/api/mobile/guilds/$guildId/roles")
            .header("Authorization", "Bearer $sessionToken")
            .get()
            .build()
        client.newCall(req).execute().use { res ->
            val body = res.body?.string().orEmpty()
            if (!res.isSuccessful) throw IllegalStateException("guild roles ${res.code}: $body")
            JSONObject(body)
        }
    }

    suspend fun addGuildKeywordFilter(
        sessionToken: String,
        guildId: String,
        platform: String,
        keyword: String,
    ): JSONObject = withContext(Dispatchers.IO) {
        if (isPreviewToken(sessionToken)) {
            return@withContext JSONObject()
                .put("ok", true)
                .put("guild_id", guildId)
                .put("keyword_filters", JSONArray())
        }
        val payload = JSONObject()
            .put("platform", platform.ifBlank { "all" })
            .put("keyword", keyword)
        val req = Request.Builder()
            .url("${base()}/api/mobile/guilds/$guildId/keyword-filters")
            .header("Authorization", "Bearer $sessionToken")
            .post(payload.toString().toRequestBody(jsonMedia))
            .build()
        client.newCall(req).execute().use { res ->
            val body = res.body?.string().orEmpty()
            if (!res.isSuccessful) throw IllegalStateException("keyword-filters POST ${res.code}: $body")
            JSONObject(body)
        }
    }

    suspend fun removeGuildKeywordFilter(
        sessionToken: String,
        guildId: String,
        platform: String,
        keyword: String,
    ): JSONObject = withContext(Dispatchers.IO) {
        if (isPreviewToken(sessionToken)) {
            return@withContext JSONObject()
                .put("ok", true)
                .put("guild_id", guildId)
                .put("keyword_filters", JSONArray())
        }
        val payload = JSONObject()
            .put("platform", platform.ifBlank { "all" })
            .put("keyword", keyword)
        val req = Request.Builder()
            .url("${base()}/api/mobile/guilds/$guildId/keyword-filters")
            .header("Authorization", "Bearer $sessionToken")
            .delete(payload.toString().toRequestBody(jsonMedia))
            .build()
        client.newCall(req).execute().use { res ->
            val body = res.body?.string().orEmpty()
            if (!res.isSuccessful) throw IllegalStateException("keyword-filters DELETE ${res.code}: $body")
            JSONObject(body)
        }
    }

    suspend fun saveGuildCreatorProfile(
        sessionToken: String,
        guildId: String,
        creatorId: String,
        displayName: String,
        twitchUrl: String,
        youtubeUrl: String,
        kickUrl: String,
        status: String,
    ): JSONObject = withContext(Dispatchers.IO) {
        val payload = JSONObject()
            .put("display_name", displayName)
            .put("twitch_url", twitchUrl)
            .put("youtube_url", youtubeUrl)
            .put("kick_url", kickUrl)
            .put("status", status)
        val req = Request.Builder()
            .url("${base()}/api/mobile/guilds/$guildId/creators/$creatorId/profile")
            .header("Authorization", "Bearer $sessionToken")
            .post(payload.toString().toRequestBody(jsonMedia))
            .build()
        client.newCall(req).execute().use { res ->
            val body = res.body?.string().orEmpty()
            if (!res.isSuccessful) throw IllegalStateException("creator profile ${res.code}: $body")
            JSONObject(body)
        }
    }

    suspend fun saveCreatorPostTemplate(
        sessionToken: String,
        creatorId: String,
        template: CreatorPostTemplate,
    ): JSONObject = withContext(Dispatchers.IO) {
        if (isPreviewToken(sessionToken)) return@withContext previewTemplateResponse(template)
        val req = Request.Builder()
            .url("${base()}/api/mobile/creators/$creatorId/post-builder/templates")
            .header("Authorization", "Bearer $sessionToken")
            .post(template.toApiJson().toString().toRequestBody(jsonMedia))
            .build()
        client.newCall(req).execute().use { res ->
            val body = res.body?.string().orEmpty()
            if (!res.isSuccessful) {
                throw IllegalStateException("template POST ${res.code}: $body")
            }
            JSONObject(body)
        }
    }

    suspend fun saveCreatorSocialConnection(
        sessionToken: String,
        creatorId: String,
        connection: CreatorSocialConnection,
    ): JSONObject = withContext(Dispatchers.IO) {
        if (isPreviewToken(sessionToken)) return@withContext previewConnectionResponse(connection)
        val req = Request.Builder()
            .url("${base()}/api/mobile/creators/$creatorId/post-builder/connections/${connection.platform}")
            .header("Authorization", "Bearer $sessionToken")
            .put(connection.toApiJson().toString().toRequestBody(jsonMedia))
            .build()
        client.newCall(req).execute().use { res ->
            val body = res.body?.string().orEmpty()
            if (!res.isSuccessful) {
                throw IllegalStateException("connection PUT ${res.code}: $body")
            }
            JSONObject(body)
        }
    }

    suspend fun startSocialOAuth(sessionToken: String, platform: String): JSONObject = withContext(Dispatchers.IO) {
        val payload = JSONObject()
            .put("platform", platform)
            .put("return_to", "mobile")
            .toString()
        val req = Request.Builder()
            .url("${base()}/api/mobile/social/oauth/start")
            .header("Authorization", "Bearer $sessionToken")
            .post(payload.toRequestBody(jsonMedia))
            .build()
        client.newCall(req).execute().use { res ->
            val body = res.body?.string().orEmpty()
            if (!res.isSuccessful) {
                throw IllegalStateException("social oauth ${res.code}: $body")
            }
            JSONObject(body)
        }
    }

    suspend fun disconnectSocialConnection(sessionToken: String, platform: String): JSONObject = withContext(Dispatchers.IO) {
        val req = Request.Builder()
            .url("${base()}/api/mobile/social/connections/$platform")
            .header("Authorization", "Bearer $sessionToken")
            .delete()
            .build()
        client.newCall(req).execute().use { res ->
            val body = res.body?.string().orEmpty()
            if (!res.isSuccessful) {
                throw IllegalStateException("social disconnect ${res.code}: $body")
            }
            JSONObject(body.ifBlank { "{}" })
        }
    }

    suspend fun selectSocialPage(sessionToken: String, platform: String, pageId: String): JSONObject = withContext(Dispatchers.IO) {
        val payload = JSONObject()
            .put("page_id", pageId)
            .toString()
        val req = Request.Builder()
            .url("${base()}/api/mobile/social/connections/$platform/select-page")
            .header("Authorization", "Bearer $sessionToken")
            .post(payload.toRequestBody(jsonMedia))
            .build()
        client.newCall(req).execute().use { res ->
            val body = res.body?.string().orEmpty()
            if (!res.isSuccessful) {
                throw IllegalStateException("social page ${res.code}: $body")
            }
            JSONObject(body)
        }
    }

    suspend fun publishCreatorPost(
        sessionToken: String,
        creatorId: String,
        template: CreatorPostTemplate,
        scheduledAt: String? = null,
    ): JSONObject = withContext(Dispatchers.IO) {
        if (isPreviewToken(sessionToken)) return@withContext previewDispatchResponse(template)
        val payload = JSONObject()
            .put("template_name", template.name)
            .put("post_text", template.postText)
            .put("link_url", if (template.linkUrl.isBlank()) JSONObject.NULL else template.linkUrl)
            .put("media_urls_json", JSONArray(template.mediaUris))
            .put("target_platforms_json", JSONArray(template.targetPlatforms))
        if (!scheduledAt.isNullOrBlank()) {
            payload.put("scheduled_at", scheduledAt)
        }
        template.remoteTemplateId?.let { payload.put("template_id", it) }

        val req = Request.Builder()
            .url("${base()}/api/mobile/creators/$creatorId/post-builder/publish")
            .header("Authorization", "Bearer $sessionToken")
            .post(payload.toString().toRequestBody(jsonMedia))
            .build()
        client.newCall(req).execute().use { res ->
            val body = res.body?.string().orEmpty()
            if (!res.isSuccessful) {
                throw IllegalStateException("publish POST ${res.code}: $body")
            }
            JSONObject(body)
        }
    }

    suspend fun automationHome(sessionToken: String): JSONObject = withContext(Dispatchers.IO) {
        previewAutomationHome(sessionToken)?.let { return@withContext it }
        val req = Request.Builder()
            .url("${base()}/api/mobile/automation/home")
            .header("Authorization", "Bearer $sessionToken")
            .get()
            .build()
        client.newCall(req).execute().use { res ->
            val body = res.body?.string().orEmpty()
            if (!res.isSuccessful) throw IllegalStateException("automation home ${res.code}: $body")
            JSONObject(body)
        }
    }

    suspend fun automationActivity(sessionToken: String, limit: Int = 50): JSONObject = withContext(Dispatchers.IO) {
        previewAutomationHome(sessionToken)?.let {
            return@withContext JSONObject()
                .put("ok", true)
                .put("items", it.optJSONArray("recent_activity") ?: JSONArray())
        }
        val req = Request.Builder()
            .url("${base()}/api/mobile/automation/activity?limit=$limit")
            .header("Authorization", "Bearer $sessionToken")
            .get()
            .build()
        client.newCall(req).execute().use { res ->
            val body = res.body?.string().orEmpty()
            if (!res.isSuccessful) throw IllegalStateException("automation activity ${res.code}: $body")
            JSONObject(body)
        }
    }

    suspend fun scheduledCreatorPosts(sessionToken: String, creatorId: String): JSONObject = withContext(Dispatchers.IO) {
        previewAutomationHome(sessionToken)?.let {
            return@withContext JSONObject()
                .put("ok", true)
                .put("scheduled", it.optJSONArray("scheduled") ?: JSONArray())
        }
        val req = Request.Builder()
            .url("${base()}/api/mobile/creators/$creatorId/post-builder/scheduled")
            .header("Authorization", "Bearer $sessionToken")
            .get()
            .build()
        client.newCall(req).execute().use { res ->
            val body = res.body?.string().orEmpty()
            if (!res.isSuccessful) throw IllegalStateException("scheduled posts ${res.code}: $body")
            JSONObject(body)
        }
    }

    suspend fun repostDispatch(
        sessionToken: String,
        dispatchId: Long,
        mode: String = "now",
        scheduledAt: String? = null,
        targetPlatforms: List<String> = emptyList(),
    ): JSONObject = withContext(Dispatchers.IO) {
        if (isPreviewToken(sessionToken)) {
            return@withContext JSONObject()
                .put("ok", true)
                .put("dispatch", JSONObject()
                    .put("dispatch_id", dispatchId + 1)
                    .put("status", if (mode == "schedule") "scheduled" else "queued")
                )
        }
        val payload = JSONObject()
            .put("mode", mode)
            .put("target_platforms_json", JSONArray(targetPlatforms))
        if (!scheduledAt.isNullOrBlank()) payload.put("scheduled_at", scheduledAt)
        val req = Request.Builder()
            .url("${base()}/api/mobile/dispatches/$dispatchId/repost")
            .header("Authorization", "Bearer $sessionToken")
            .post(payload.toString().toRequestBody(jsonMedia))
            .build()
        client.newCall(req).execute().use { res ->
            val body = res.body?.string().orEmpty()
            if (!res.isSuccessful) throw IllegalStateException("repost ${res.code}: $body")
            JSONObject(body)
        }
    }

    suspend fun registerPushDevice(
        sessionToken: String,
        pushToken: String,
        appVersion: String = BuildConfig.VERSION_NAME,
    ): JSONObject = withContext(Dispatchers.IO) {
        if (isPreviewToken(sessionToken)) return@withContext JSONObject().put("ok", true)
        val payload = JSONObject()
            .put("push_token", pushToken)
            .put("device_platform", "android")
            .put("app_version", appVersion)
        val req = Request.Builder()
            .url("${base()}/api/mobile/devices")
            .header("Authorization", "Bearer $sessionToken")
            .post(payload.toString().toRequestBody(jsonMedia))
            .build()
        client.newCall(req).execute().use { res ->
            val body = res.body?.string().orEmpty()
            if (!res.isSuccessful) throw IllegalStateException("push device ${res.code}: $body")
            JSONObject(body)
        }
    }

    suspend fun unregisterPushDevice(sessionToken: String, pushToken: String): JSONObject = withContext(Dispatchers.IO) {
        if (isPreviewToken(sessionToken)) return@withContext JSONObject().put("ok", true)
        val payload = JSONObject().put("push_token", pushToken)
        val req = Request.Builder()
            .url("${base()}/api/mobile/devices")
            .header("Authorization", "Bearer $sessionToken")
            .delete(payload.toString().toRequestBody(jsonMedia))
            .build()
        client.newCall(req).execute().use { res ->
            val body = res.body?.string().orEmpty()
            if (!res.isSuccessful) throw IllegalStateException("push delete ${res.code}: $body")
            JSONObject(body)
        }
    }
}
