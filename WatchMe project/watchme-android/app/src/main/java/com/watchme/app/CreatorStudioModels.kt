package com.watchme.app

import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

val CreatorStudioPlatforms = listOf("facebook", "instagram", "x", "tiktok", "youtube", "twitch")

fun normalizeCreatorPlatforms(platforms: Collection<String>): List<String> {
    return platforms
        .mapNotNull { value ->
            value.trim().lowercase().takeIf { it in CreatorStudioPlatforms }
        }
        .distinct()
}

fun platformDisplayName(platform: String): String {
    return when (platform.lowercase()) {
        "facebook" -> "Facebook"
        "instagram" -> "Instagram"
        "x" -> "X"
        "tiktok" -> "TikTok"
        "youtube" -> "YouTube"
        "twitch" -> "Twitch"
        else -> platform.replaceFirstChar { it.uppercase() }
    }
}

private fun listToJsonArray(values: List<String>): JSONArray {
    val array = JSONArray()
    values.forEach(array::put)
    return array
}

private fun jsonArrayToStringList(array: JSONArray?): List<String> {
    if (array == null) return emptyList()
    return List(array.length()) { index -> array.optString(index) }
        .map(String::trim)
        .filter(String::isNotEmpty)
}

data class CreatorPostTemplate(
    val localId: String = UUID.randomUUID().toString(),
    val remoteTemplateId: Long? = null,
    val name: String = "Quick post",
    val postText: String = "",
    val linkUrl: String = "",
    val mediaUris: List<String> = emptyList(),
    val targetPlatforms: List<String> = emptyList(),
    val isDefault: Boolean = false,
    val updatedAtEpochMs: Long = System.currentTimeMillis(),
) {
    fun toStorageJson(): JSONObject {
        return JSONObject()
            .put("local_id", localId)
            .put("remote_template_id", remoteTemplateId ?: JSONObject.NULL)
            .put("name", name)
            .put("post_text", postText)
            .put("link_url", linkUrl)
            .put("media_uris", listToJsonArray(mediaUris))
            .put("target_platforms", listToJsonArray(targetPlatforms))
            .put("is_default", isDefault)
            .put("updated_at_epoch_ms", updatedAtEpochMs)
    }

    fun toApiJson(): JSONObject {
        val payload = JSONObject()
            .put("name", name)
            .put("post_text", postText)
            .put("link_url", if (linkUrl.isBlank()) JSONObject.NULL else linkUrl)
            .put("media_urls_json", listToJsonArray(mediaUris))
            .put("target_platforms_json", listToJsonArray(targetPlatforms))
            .put("is_default", isDefault)
        remoteTemplateId?.let { payload.put("template_id", it) }
        return payload
    }

    companion object {
        fun fromStorageJson(json: JSONObject): CreatorPostTemplate {
            return CreatorPostTemplate(
                localId = json.optString("local_id").ifBlank { UUID.randomUUID().toString() },
                remoteTemplateId = json.optLong("remote_template_id").takeIf { it > 0L },
                name = json.optString("name").ifBlank { "Quick post" },
                postText = json.optString("post_text"),
                linkUrl = json.optString("link_url"),
                mediaUris = jsonArrayToStringList(json.optJSONArray("media_uris")),
                targetPlatforms = normalizeCreatorPlatforms(
                    jsonArrayToStringList(json.optJSONArray("target_platforms"))
                ),
                isDefault = json.optBoolean("is_default", false),
                updatedAtEpochMs = json.optLong("updated_at_epoch_ms")
                    .takeIf { it > 0L }
                    ?: System.currentTimeMillis(),
            )
        }

        fun fromApiJson(json: JSONObject): CreatorPostTemplate {
            val remoteTemplateId = json.optLong("template_id").takeIf { it > 0L }
            return CreatorPostTemplate(
                localId = json.optString("local_id").ifBlank {
                    remoteTemplateId?.let { "remote-template-$it" } ?: UUID.randomUUID().toString()
                },
                remoteTemplateId = remoteTemplateId,
                name = json.optString("name").ifBlank { "Quick post" },
                postText = json.optString("post_text"),
                linkUrl = json.optString("link_url"),
                mediaUris = jsonArrayToStringList(json.optJSONArray("media_urls_json")),
                targetPlatforms = normalizeCreatorPlatforms(
                    jsonArrayToStringList(json.optJSONArray("target_platforms_json"))
                ),
                isDefault = json.optBoolean("is_default", false),
                updatedAtEpochMs = System.currentTimeMillis(),
            )
        }
    }
}

data class CreatorSocialConnection(
    val platform: String,
    val externalAccountId: String = "",
    val externalAccountName: String = "",
    val status: String = "active",
    val tokenExpiresAt: String = "",
    val notes: String = "",
    val pageOptions: List<SocialPageOption> = emptyList(),
    val avatarUrl: String = "",
    val updatedAtEpochMs: Long = System.currentTimeMillis(),
) {
    fun toStorageJson(): JSONObject {
        return JSONObject()
            .put("platform", platform)
            .put("external_account_id", externalAccountId)
            .put("external_account_name", externalAccountName)
            .put("status", status)
            .put("token_expires_at", tokenExpiresAt)
            .put("notes", notes)
            .put("avatar_url", avatarUrl)
            .put("updated_at_epoch_ms", updatedAtEpochMs)
    }

    fun toApiJson(): JSONObject {
        val metadata = JSONObject()
        if (notes.isNotBlank()) {
            metadata.put("notes", notes)
        }
        return JSONObject()
            .put("external_account_id", if (externalAccountId.isBlank()) JSONObject.NULL else externalAccountId)
            .put("external_account_name", if (externalAccountName.isBlank()) JSONObject.NULL else externalAccountName)
            .put("status", if (status.isBlank()) "active" else status)
            .put("token_expires_at", if (tokenExpiresAt.isBlank()) JSONObject.NULL else tokenExpiresAt)
            .put("metadata_json", metadata)
    }

    companion object {
        fun fromStorageJson(json: JSONObject): CreatorSocialConnection {
            return CreatorSocialConnection(
                platform = json.optString("platform").ifBlank { "facebook" },
                externalAccountId = json.optString("external_account_id"),
                externalAccountName = json.optString("external_account_name"),
                status = json.optString("status").ifBlank { "active" },
                tokenExpiresAt = json.optString("token_expires_at"),
                notes = json.optString("notes"),
                pageOptions = emptyList(),
                avatarUrl = json.optString("avatar_url"),
                updatedAtEpochMs = json.optLong("updated_at_epoch_ms")
                    .takeIf { it > 0L }
                    ?: System.currentTimeMillis(),
            )
        }

        fun fromApiJson(json: JSONObject): CreatorSocialConnection {
            val metadata = json.optJSONObject("metadata_json")
            val notes = metadata?.optString("notes").orEmpty()
            val optionsArray = metadata?.optJSONArray("page_options")
            val avatar = metadata?.optString("avatar_url").orEmpty()
                .ifBlank { metadata?.optString("profile_picture_url").orEmpty() }
                .ifBlank { metadata?.optString("picture").orEmpty() }
            return CreatorSocialConnection(
                platform = json.optString("platform").ifBlank { "facebook" },
                externalAccountId = json.optString("external_account_id"),
                externalAccountName = json.optString("external_account_name"),
                status = json.optString("status").ifBlank { "active" },
                tokenExpiresAt = json.optString("token_expires_at"),
                notes = notes,
                avatarUrl = avatar.trim(),
                pageOptions = buildList {
                    if (optionsArray != null) {
                        for (index in 0 until optionsArray.length()) {
                            val option = optionsArray.optJSONObject(index) ?: continue
                            val id = option.optString("id").trim()
                            if (id.isNotBlank()) {
                                add(
                                    SocialPageOption(
                                        id = id,
                                        name = option.optString("name").trim().ifBlank { id },
                                        category = option.optString("category").trim(),
                                        instagramAccountId = option.optString("instagram_account_id").trim(),
                                        instagramAccountName = option.optString("instagram_account_name").trim(),
                                    )
                                )
                            }
                        }
                    }
                },
                updatedAtEpochMs = System.currentTimeMillis(),
            )
        }
    }
}

data class SocialPageOption(
    val id: String,
    val name: String,
    val category: String = "",
    val instagramAccountId: String = "",
    val instagramAccountName: String = "",
)

data class CreatorDispatchRecord(
    val localId: String = UUID.randomUUID().toString(),
    val remoteDispatchId: Long? = null,
    val templateName: String = "Quick post",
    val postText: String = "",
    val linkUrl: String = "",
    val mediaUris: List<String> = emptyList(),
    val targetPlatforms: List<String> = emptyList(),
    val status: String = "saved_local",
    val note: String = "",
    val createdAtEpochMs: Long = System.currentTimeMillis(),
) {
    fun toStorageJson(): JSONObject {
        return JSONObject()
            .put("local_id", localId)
            .put("remote_dispatch_id", remoteDispatchId ?: JSONObject.NULL)
            .put("template_name", templateName)
            .put("post_text", postText)
            .put("link_url", linkUrl)
            .put("media_uris", listToJsonArray(mediaUris))
            .put("target_platforms", listToJsonArray(targetPlatforms))
            .put("status", status)
            .put("note", note)
            .put("created_at_epoch_ms", createdAtEpochMs)
    }

    companion object {
        fun fromStorageJson(json: JSONObject): CreatorDispatchRecord {
            return CreatorDispatchRecord(
                localId = json.optString("local_id").ifBlank { UUID.randomUUID().toString() },
                remoteDispatchId = json.optLong("remote_dispatch_id").takeIf { it > 0L },
                templateName = json.optString("template_name").ifBlank { "Quick post" },
                postText = json.optString("post_text"),
                linkUrl = json.optString("link_url"),
                mediaUris = jsonArrayToStringList(json.optJSONArray("media_uris")),
                targetPlatforms = normalizeCreatorPlatforms(
                    jsonArrayToStringList(json.optJSONArray("target_platforms"))
                ),
                status = json.optString("status").ifBlank { "saved_local" },
                note = json.optString("note"),
                createdAtEpochMs = json.optLong("created_at_epoch_ms")
                    .takeIf { it > 0L }
                    ?: System.currentTimeMillis(),
            )
        }

        fun fromApiJson(json: JSONObject, fallbackTemplateName: String): CreatorDispatchRecord {
            val payload = json.optJSONObject("payload_json")
            return CreatorDispatchRecord(
                localId = json.optString("local_id").ifBlank {
                    json.optLong("dispatch_id").takeIf { it > 0L }
                        ?.let { "remote-dispatch-$it" }
                        ?: UUID.randomUUID().toString()
                },
                remoteDispatchId = json.optLong("dispatch_id").takeIf { it > 0L },
                templateName = payload?.optString("template_name")
                    ?.takeIf { it.isNotBlank() }
                    ?: fallbackTemplateName,
                postText = payload?.optString("post_text").orEmpty(),
                linkUrl = payload?.optString("link_url").orEmpty(),
                mediaUris = jsonArrayToStringList(payload?.optJSONArray("media_urls_json")),
                targetPlatforms = normalizeCreatorPlatforms(
                    jsonArrayToStringList(json.optJSONArray("target_platforms_json"))
                ),
                status = json.optString("status").ifBlank { "queued" },
                note = "Queued on WatchMe server",
                createdAtEpochMs = System.currentTimeMillis(),
            )
        }
    }
}
