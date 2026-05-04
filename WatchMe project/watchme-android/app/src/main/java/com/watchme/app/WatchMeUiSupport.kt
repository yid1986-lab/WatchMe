package com.watchme.app

import org.json.JSONObject
import java.text.DateFormat
import java.util.Locale

private const val WatchMeLiteDiscordInviteUrlFallback = "https://discord.com/invite/watchme"

data class GuildOption(
    val guildId: String,
    val guildName: String,
)

fun formatLiveStatus(status: JSONObject): String {
    val parts = mutableListOf<String>()

    when {
        status.has("is_live") -> parts += if (status.optBoolean("is_live")) "Live now" else "Offline"
        status.has("live") -> parts += if (status.optBoolean("live")) "Live now" else "Offline"
    }

    listOf("platform", "provider", "service")
        .firstNotNullOfOrNull { key -> status.optString(key).takeIf { it.isNotBlank() } }
        ?.let(parts::add)

    listOf("title", "stream_title", "message")
        .firstNotNullOfOrNull { key -> status.optString(key).takeIf { it.isNotBlank() } }
        ?.let(parts::add)

    listOf("checked_at", "last_checked_at", "last_detected_at")
        .firstNotNullOfOrNull { key -> status.optString(key).takeIf { it.isNotBlank() } }
        ?.let { parts += "Checked $it" }

    return if (parts.isNotEmpty()) {
        parts.joinToString(" | ")
    } else {
        "Status is ready on the WatchMe server."
    }
}

fun formatFileSize(bytes: Long): String {
    if (bytes <= 0L) return "0 B"
    val units = listOf("B", "KB", "MB", "GB")
    var value = bytes.toDouble()
    var unitIndex = 0
    while (value >= 1024 && unitIndex < units.lastIndex) {
        value /= 1024
        unitIndex++
    }
    val precision = if (value >= 10 || unitIndex == 0) 0 else 1
    return String.format(Locale.getDefault(), "%.${precision}f %s", value, units[unitIndex])
}

fun formatDuration(durationMs: Long): String {
    val totalSeconds = durationMs / 1000
    val hours = totalSeconds / 3600
    val minutes = (totalSeconds % 3600) / 60
    val seconds = totalSeconds % 60
    return if (hours > 0) {
        String.format(Locale.getDefault(), "%d:%02d:%02d", hours, minutes, seconds)
    } else {
        String.format(Locale.getDefault(), "%d:%02d", minutes, seconds)
    }
}

fun formatMimeType(mimeType: String): String {
    val shortType = mimeType.substringAfter('/', mimeType)
    return shortType.replace('-', ' ').uppercase(Locale.getDefault())
}

fun extractAccountName(profile: JSONObject): String {
    return listOf(
        profile.optString("display_name"),
        profile.optString("discord_username"),
        profile.optString("username"),
        profile.optJSONObject("identity")?.optString("display_name").orEmpty(),
        profile.optJSONObject("identity")?.optString("discord_username").orEmpty(),
        profile.optJSONObject("identity")?.optString("username").orEmpty(),
    ).firstOrNull { it.isNotBlank() } ?: "Discord"
}

fun extractGuildOptions(profile: JSONObject): List<GuildOption> {
    val arrays = listOfNotNull(
        profile.optJSONArray("guilds"),
        profile.optJSONArray("discord_guilds"),
        profile.optJSONArray("manageable_guilds"),
        profile.optJSONArray("servers"),
        profile.optJSONObject("identity")?.optJSONArray("guilds"),
    )

    return arrays.flatMap { array ->
        buildList {
            for (index in 0 until array.length()) {
                when (val item = array.opt(index)) {
                    is JSONObject -> {
                        val id = listOf("guild_id", "id", "server_id")
                            .firstNotNullOfOrNull { key -> item.optString(key).takeIf(String::isNotBlank) }
                            .orEmpty()
                        val name = listOf("guild_name", "name", "server_name")
                            .firstNotNullOfOrNull { key -> item.optString(key).takeIf(String::isNotBlank) }
                            ?: id
                        if (id.isNotBlank() || name.isNotBlank()) {
                            add(GuildOption(guildId = id.ifBlank { name }, guildName = name))
                        }
                    }

                    is String -> {
                        if (item.isNotBlank()) {
                            add(GuildOption(guildId = item, guildName = item))
                        }
                    }
                }
            }
        }
    }.distinctBy { it.guildId.lowercase(Locale.getDefault()) }
}

fun mergeGuildOptions(
    availableGuilds: List<GuildOption>,
    selectedGuildId: String,
    selectedGuildName: String,
): List<GuildOption> {
    val merged = availableGuilds.toMutableList()
    if (selectedGuildId.isNotBlank() || selectedGuildName.isNotBlank()) {
        val existing = merged.any {
            it.guildId.equals(selectedGuildId, ignoreCase = true) ||
                it.guildName.equals(selectedGuildName, ignoreCase = true)
        }
        if (!existing) {
            merged += GuildOption(
                guildId = selectedGuildId.ifBlank { selectedGuildName },
                guildName = selectedGuildName.ifBlank { selectedGuildId },
            )
        }
    }
    return merged
}

fun extractProAccess(profile: JSONObject): Boolean {
    val directProKeys = listOf(
        "is_pro",
        "pro",
        "has_pro",
        "pro_access",
        "pro_member",
        "watchme_pro",
        "verified_pro",
        "pro_subscription_active",
    )
    if (profile.hasTruthyValue(directProKeys)) return true
    if (profile.rolesContainPro()) return true

    val nestedObjects = listOf(
        "entitlements",
        "entitlement",
        "access",
        "membership",
        "subscription",
        "identity",
        "user",
        "discord",
    ).mapNotNull(profile::optJSONObject)

    return nestedObjects.any { item ->
        item.hasTruthyValue(directProKeys) ||
            item.hasActiveProPlan() ||
            item.rolesContainPro()
    }
}

fun extractLiteDiscordInviteUrl(profile: JSONObject): String {
    val keys = listOf(
        "lite_discord_invite_url",
        "discord_lite_invite_url",
        "lite_invite_url",
        "discord_invite_url",
    )
    val nestedObjects = listOf(
        profile,
        profile.optJSONObject("links"),
        profile.optJSONObject("discord"),
        profile.optJSONObject("membership"),
    ).filterNotNull()

    return nestedObjects
        .firstNotNullOfOrNull { item ->
            keys.firstNotNullOfOrNull { key ->
                item.optString(key).takeIf { it.startsWith("http", ignoreCase = true) }
            }
        }
        ?: WatchMeLiteDiscordInviteUrlFallback
}

private fun JSONObject.hasTruthyValue(keys: List<String>): Boolean {
    return keys.any { key ->
        if (!has(key) || isNull(key)) return@any false
        when (val raw = opt(key)) {
            is Boolean -> raw
            is Number -> raw.toInt() != 0
            is String -> raw.trim().lowercase(Locale.getDefault()) in setOf(
                "true",
                "yes",
                "active",
                "paid",
                "pro",
                "verified",
                "premium",
                "trialing",
            )

            else -> false
        }
    }
}

private fun JSONObject.hasActiveProPlan(): Boolean {
    val planText = listOf("tier", "plan", "product", "product_name", "name", "role")
        .joinToString(" ") { optString(it) }
        .lowercase(Locale.getDefault())
    if (!planText.contains("pro") || planText.contains("lite")) return false

    val status = optString("status").lowercase(Locale.getDefault())
    return status.isBlank() || status in setOf("active", "paid", "trialing", "verified")
}

private fun JSONObject.rolesContainPro(): Boolean {
    val array = optJSONArray("roles")
        ?: optJSONArray("discord_roles")
        ?: optJSONArray("role_names")
        ?: return false

    for (index in 0 until array.length()) {
        val roleText = when (val item = array.opt(index)) {
            is String -> item
            is JSONObject -> listOf("name", "role", "slug", "title")
                .joinToString(" ") { item.optString(it) }

            else -> ""
        }.lowercase(Locale.getDefault())

        if (roleText.contains("pro") && !roleText.contains("lite")) {
            return true
        }
    }
    return false
}

fun platformMonogram(platform: String): String {
    return when (platform.trim().lowercase(Locale.getDefault())) {
        "facebook", "fb" -> "FB"
        "instagram", "ig" -> "IG"
        "x", "twitter" -> "X"
        "tiktok" -> "TT"
        "youtube", "yt" -> "YT"
        "twitch" -> "TW"
        "discord" -> "DC"
        "paypal" -> "PP"
        "watchme_pro", "pro" -> "PRO"
        else -> platform.trim().take(2).uppercase(Locale.getDefault())
    }
}

fun platformLogoRes(platform: String): Int? {
    return when (platform.trim().lowercase(Locale.getDefault())) {
        "facebook", "fb" -> R.drawable.logo_facebook
        "instagram", "ig" -> R.drawable.logo_instagram
        "x", "twitter" -> R.drawable.logo_x
        "tiktok", "tt" -> R.drawable.logo_tiktok
        "discord" -> R.drawable.logo_discord
        "paypal" -> R.drawable.logo_paypal
        "youtube", "yt" -> R.drawable.logo_youtube
        "twitch" -> R.drawable.logo_twitch
        "watchme" -> R.drawable.logo_watchme_pro_mark
        "watchme_pro", "pro" -> R.drawable.logo_watchme_mark
        else -> null
    }
}

fun sortCreatorTemplates(templates: List<CreatorPostTemplate>): List<CreatorPostTemplate> {
    return templates.sortedWith(
        compareByDescending<CreatorPostTemplate> { it.isDefault }
            .thenByDescending { it.updatedAtEpochMs }
            .thenBy { it.name.lowercase(Locale.getDefault()) },
    )
}

fun sortCreatorConnections(connections: List<CreatorSocialConnection>): List<CreatorSocialConnection> {
    return connections.sortedBy { it.platform.lowercase(Locale.getDefault()) }
}

fun sortCreatorDispatches(dispatches: List<CreatorDispatchRecord>): List<CreatorDispatchRecord> {
    return dispatches.sortedByDescending { it.createdAtEpochMs }
}

fun sortMemberRequests(requests: List<MemberRequestItem>): List<MemberRequestItem> {
    return requests.sortedByDescending { it.createdAtEpochMs }
}

fun mergeRemoteTemplates(
    local: List<CreatorPostTemplate>,
    remote: List<CreatorPostTemplate>,
): List<CreatorPostTemplate> {
    val byRemoteId = local
        .filter { it.remoteTemplateId != null }
        .associateBy { it.remoteTemplateId }
        .toMutableMap()

    val remoteWithoutIds = mutableListOf<CreatorPostTemplate>()

    remote.forEach { template ->
        val remoteId = template.remoteTemplateId
        if (remoteId == null) {
            remoteWithoutIds += template
            return@forEach
        }
        val existing = byRemoteId[template.remoteTemplateId]
        byRemoteId[remoteId] = if (existing == null) {
            template
        } else {
            template.copy(localId = existing.localId)
        }
    }

    val localOnly = local.filter { it.remoteTemplateId == null }
    return sortCreatorTemplates(byRemoteId.values.toList() + localOnly + remoteWithoutIds)
}

fun mergeRemoteConnections(
    local: List<CreatorSocialConnection>,
    remote: List<CreatorSocialConnection>,
): List<CreatorSocialConnection> {
    val merged = local.associateBy { it.platform.lowercase(Locale.getDefault()) }.toMutableMap()
    remote.forEach { connection ->
        merged[connection.platform.lowercase(Locale.getDefault())] = connection
    }
    return sortCreatorConnections(merged.values.toList())
}

fun formatStudioTimestamp(epochMs: Long): String {
    return runCatching {
        DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT)
            .format(java.util.Date(epochMs))
    }.getOrDefault("Saved")
}

fun pluralSuffix(count: Int): String = if (count == 1) "" else "s"
