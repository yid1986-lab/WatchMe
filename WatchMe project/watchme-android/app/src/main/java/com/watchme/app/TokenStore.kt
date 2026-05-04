package com.watchme.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class TokenStore(context: Context) {
    private val p = context.getSharedPreferences("watchme", Context.MODE_PRIVATE)
    private val securePrefs = SecurePrefs()

    private inner class SecurePrefs {
        private val keyAlias = "watchme_secure_store"
        private val encryptedPrefix = "enc:"

        private fun getSecretKey(): SecretKey {
            val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            val existing = keyStore.getEntry(keyAlias, null) as? KeyStore.SecretKeyEntry
            if (existing != null) {
                return existing.secretKey
            }

            val keyGenerator = KeyGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_AES,
                "AndroidKeyStore",
            )
            keyGenerator.init(
                KeyGenParameterSpec.Builder(
                    keyAlias,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .build(),
            )
            return keyGenerator.generateKey()
        }

        private fun encrypt(value: String): String {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, getSecretKey())
            val iv = cipher.iv
            val ciphertext = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
            val encodedIv = Base64.encodeToString(iv, Base64.NO_WRAP)
            val encodedCiphertext = Base64.encodeToString(ciphertext, Base64.NO_WRAP)
            return "$encryptedPrefix$encodedIv.$encodedCiphertext"
        }

        private fun decrypt(value: String): String? {
            val raw = value.removePrefix(encryptedPrefix)
            val parts = raw.split(".", limit = 2)
            if (parts.size != 2) return null

            val iv = Base64.decode(parts[0], Base64.NO_WRAP)
            val ciphertext = Base64.decode(parts[1], Base64.NO_WRAP)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(
                Cipher.DECRYPT_MODE,
                getSecretKey(),
                GCMParameterSpec(128, iv),
            )
            return String(cipher.doFinal(ciphertext), Charsets.UTF_8)
        }

        fun get(key: String): String? {
            val raw = p.getString(key, null) ?: return null
            if (!raw.startsWith(encryptedPrefix)) {
                put(key, raw)
                return raw
            }

            return runCatching { decrypt(raw) }.getOrNull()
        }

        fun put(key: String, value: String?) {
            p.edit().apply {
                if (value == null) {
                    remove(key)
                } else {
                    putString(key, encrypt(value))
                }
            }.apply()
        }
    }

    private fun getStringList(key: String): List<String> {
        val raw = p.getString(key, null) ?: return emptyList()
        return runCatching {
            val array = JSONArray(raw)
            List(array.length()) { index -> array.getString(index) }
        }.getOrDefault(emptyList())
    }

    private fun putStringList(key: String, value: List<String>) {
        val array = JSONArray()
        value.forEach(array::put)
        p.edit().putString(key, array.toString()).apply()
    }

    private fun <T> getObjectList(key: String, parser: (org.json.JSONObject) -> T): List<T> {
        val raw = p.getString(key, null) ?: return emptyList()
        return runCatching {
            val array = JSONArray(raw)
            buildList {
                for (index in 0 until array.length()) {
                    val item = array.optJSONObject(index) ?: continue
                    add(parser(item))
                }
            }
        }.getOrDefault(emptyList())
    }

    private fun <T> putObjectList(
        key: String,
        value: List<T>,
        serializer: (T) -> org.json.JSONObject,
    ) {
        val array = JSONArray()
        value.forEach { item -> array.put(serializer(item)) }
        p.edit().putString(key, array.toString()).apply()
    }

    var discordAccessToken: String?
        get() = securePrefs.get("discord_access_token")
        set(v) {
            securePrefs.put("discord_access_token", v)
        }

    var pendingDiscordAuthState: String?
        get() = securePrefs.get("pending_discord_auth_state")
        set(value) = securePrefs.put("pending_discord_auth_state", value)

    var pendingDiscordRedirectUri: String?
        get() = securePrefs.get("pending_discord_redirect_uri")
        set(value) = securePrefs.put("pending_discord_redirect_uri", value)

    var pendingDiscordVerifier: String?
        get() = securePrefs.get("pending_discord_verifier")
        set(value) = securePrefs.put("pending_discord_verifier", value)

    var firebasePushToken: String?
        get() = securePrefs.get("firebase_push_token")
        set(value) = securePrefs.put("firebase_push_token", value)

    /** Last known backend Pro entitlement; the UI re-checks this after Discord login. */
    var proAccessUnlocked: Boolean
        get() = p.getBoolean("pro_access_unlocked", false)
        set(v) = p.edit().putBoolean("pro_access_unlocked", v).apply()

    /** ~15 min checks via WorkManager (battery-friendly). */
    var backgroundLiveMonitor: Boolean
        get() = p.getBoolean("bg_live_monitor", false)
        set(v) = p.edit().putBoolean("bg_live_monitor", v).apply()

    /** ~3 min checks via foreground service (persistent notification). */
    var fastLiveMonitor: Boolean
        get() = p.getBoolean("fast_live_monitor", false)
        set(v) = p.edit().putBoolean("fast_live_monitor", v).apply()

    /** Recent on-device image picks kept available for quick mobile reuse. */
    var imageLibraryUris: List<String>
        get() = getStringList("image_library_uris")
        set(value) = putStringList("image_library_uris", value)

    /** Recent on-device video picks kept available for quick mobile reuse. */
    var videoLibraryUris: List<String>
        get() = getStringList("video_library_uris")
        set(value) = putStringList("video_library_uris", value)

    /** Optional creator id used when the V2 mobile routes are live. */
    var creatorStudioUserId: String?
        get() = p.getString("creator_studio_user_id", null)
        set(value) = p.edit().putString("creator_studio_user_id", value).apply()

    /** Guild/server currently selected for management in the mobile dashboard. */
    var selectedGuildId: String?
        get() = p.getString("selected_guild_id", null)
        set(value) = p.edit().putString("selected_guild_id", value).apply()

    /** Friendly guild/server name for the current selection. */
    var selectedGuildName: String?
        get() = p.getString("selected_guild_name", null)
        set(value) = p.edit().putString("selected_guild_name", value).apply()

    /** Locally saved post templates for the creator-side mobile builder. */
    var creatorPostTemplates: List<CreatorPostTemplate>
        get() = getObjectList("creator_post_templates", CreatorPostTemplate::fromStorageJson)
        set(value) = putObjectList(
            "creator_post_templates",
            value,
            CreatorPostTemplate::toStorageJson,
        )

    /** Locally saved social connections for the creator-side mobile builder. */
    var creatorSocialConnections: List<CreatorSocialConnection>
        get() = getObjectList("creator_social_connections", CreatorSocialConnection::fromStorageJson)
        set(value) = putObjectList(
            "creator_social_connections",
            value,
            CreatorSocialConnection::toStorageJson,
        )

    /** Local publish queue/history kept until the backend publish flow is fully wired. */
    var creatorDispatchHistory: List<CreatorDispatchRecord>
        get() = getObjectList("creator_dispatch_history", CreatorDispatchRecord::fromStorageJson)
        set(value) = putObjectList(
            "creator_dispatch_history",
            value,
            CreatorDispatchRecord::toStorageJson,
        )

    /** Local creator/channel roster managed from the mobile dashboard. */
    var memberRequests: List<MemberRequestItem>
        get() = getObjectList("member_requests", MemberRequestItem::fromStorageJson)
        set(value) = putObjectList(
            "member_requests",
            value,
            MemberRequestItem::toStorageJson,
        )
}
