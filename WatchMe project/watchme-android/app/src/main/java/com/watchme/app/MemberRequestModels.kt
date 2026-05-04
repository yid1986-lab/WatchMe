package com.watchme.app

import org.json.JSONObject
import java.util.UUID

data class MemberRequestItem(
    val localId: String = UUID.randomUUID().toString(),
    val memberName: String = "",
    val requestType: String = "general",
    val platform: String = "",
    val notes: String = "",
    val status: String = "new",
    val createdAtEpochMs: Long = System.currentTimeMillis(),
) {
    fun toStorageJson(): JSONObject {
        return JSONObject()
            .put("local_id", localId)
            .put("member_name", memberName)
            .put("request_type", requestType)
            .put("platform", platform)
            .put("notes", notes)
            .put("status", status)
            .put("created_at_epoch_ms", createdAtEpochMs)
    }

    companion object {
        fun fromStorageJson(json: JSONObject): MemberRequestItem {
            return MemberRequestItem(
                localId = json.optString("local_id").ifBlank { UUID.randomUUID().toString() },
                memberName = json.optString("member_name"),
                requestType = json.optString("request_type").ifBlank { "general" },
                platform = json.optString("platform"),
                notes = json.optString("notes"),
                status = json.optString("status").ifBlank { "new" },
                createdAtEpochMs = json.optLong("created_at_epoch_ms")
                    .takeIf { it > 0L }
                    ?: System.currentTimeMillis(),
            )
        }
    }
}
