package com.watchme.app

import org.json.JSONObject

data class AutomationSummary(
    val creatorsLive: Int = 0,
    val postsToday: Int = 0,
    val successRate: Int? = null,
    val topPlatform: String = "",
    val scheduledCount: Int = 0,
    val needsAttention: Int = 0,
) {
    companion object {
        fun fromJson(json: JSONObject?): AutomationSummary {
            return AutomationSummary(
                creatorsLive = json?.optInt("creators_live") ?: 0,
                postsToday = json?.optInt("posts_today") ?: 0,
                successRate = json?.takeIf { !it.isNull("success_rate") }?.optInt("success_rate"),
                topPlatform = json?.optString("top_platform").orEmpty(),
                scheduledCount = json?.optInt("scheduled_count") ?: 0,
                needsAttention = json?.optInt("needs_attention") ?: 0,
            )
        }
    }
}

data class AutomationActivityItem(
    val activityId: Long,
    val eventType: String,
    val title: String,
    val body: String,
    val severity: String,
    val platform: String,
    val createdAt: String,
    /** Populated from API metadata when available (preferred for live headlines). */
    val creatorHint: String = "",
) {
    companion object {
        fun fromJson(json: JSONObject): AutomationActivityItem {
            val meta = json.optJSONObject("metadata")
            val creatorHint = json.optString("creator_display_name")
                .ifBlank { json.optString("creator_name") }
                .ifBlank { meta?.optString("creator_display_name").orEmpty() }
                .ifBlank { meta?.optString("creator_name").orEmpty() }
                .ifBlank { meta?.optString("display_name").orEmpty() }
            return AutomationActivityItem(
                activityId = json.optLong("activity_id"),
                eventType = json.optString("event_type"),
                title = json.optString("title").ifBlank { "WatchMe activity" },
                body = json.optString("body"),
                severity = json.optString("severity").ifBlank { "info" },
                platform = json.optString("platform"),
                createdAt = json.optString("created_at"),
                creatorHint = creatorHint.trim(),
            )
        }
    }
}
