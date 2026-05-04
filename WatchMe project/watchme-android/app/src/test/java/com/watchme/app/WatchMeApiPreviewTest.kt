package com.watchme.app

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WatchMeApiPreviewTest {

    @Test
    fun previewProProfileExposesProAccess() = runBlocking {
        val profile = WatchMeApi.getProfile("preview-pro")

        assertTrue(extractProAccess(profile))
        assertEquals("WatchMe Pro", profile.getJSONObject("membership").getString("plan"))
        assertEquals("Alex Rivers", profile.getString("display_name"))
    }

    @Test
    fun previewLiteLiveStatusStaysOffline() = runBlocking {
        val status = WatchMeApi.liveStatus("preview-lite")

        assertFalse(status.getBoolean("is_live"))
        assertEquals("Discord", status.getString("platform"))
    }

    @Test
    fun previewPostBuilderReturnsTemplatesAndConnections() = runBlocking {
        val builder = WatchMeApi.getCreatorPostBuilder("preview-pro", "creator-123")

        assertTrue(builder.getJSONArray("templates").length() > 0)
        assertTrue(builder.getJSONArray("connections").length() > 0)
    }
}
