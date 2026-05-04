package com.watchme.app

import android.content.Context
import androidx.activity.ComponentActivity
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import org.json.JSONObject
import org.junit.Before
import org.junit.Rule
import org.junit.Test

class WatchMeAppUiTest {

    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Before
    fun clearWatchMeStore() {
        composeRule.activity
            .getSharedPreferences("watchme", Context.MODE_PRIVATE)
            .edit()
            .clear()
            .commit()
    }

    @Test
    fun loggedOutUsersSeeDiscordLoginGate() {
        composeRule.setContent {
            WatchMeTheme {
                WatchMeApp(
                    token = null,
                    statusMessage = mutableStateOf(null),
                    onOpenDiscordLogin = { _, _ -> },
                    onLogout = {},
                    onSaveProfile = { _, _, _, _ -> JSONObject() },
                    onLoadProfile = { JSONObject() },
                    onLiveSync = { JSONObject() },
                    onLoadLiveStatus = { JSONObject() },
                    onLoadCreatorPostBuilder = { JSONObject() },
                    onLoadGuildWorkspace = { JSONObject() },
                    onLoadGuildChannels = { JSONObject() },
                    onLoadGuildMembers = { JSONObject() },
                    onSaveGuildConfig = { _, _ -> JSONObject() },
                    onAddGuildKeywordFilter = { _, _, _ -> JSONObject() },
                    onRemoveGuildKeywordFilter = { _, _, _ -> JSONObject() },
                    onSaveCreatorTemplate = { _, _ -> JSONObject() },
                    onSaveCreatorConnection = { _, _ -> JSONObject() },
                    onPublishCreatorPost = { _, _, _ -> JSONObject() },
                    onLoadAutomationHome = { JSONObject() },
                    onLoadAutomationActivity = { JSONObject() },
                    onLoadScheduledPosts = { _ -> JSONObject() },
                    onRepostDispatch = { _ -> JSONObject() },
                    store = TokenStore(composeRule.activity),
                    activity = composeRule.activity,
                )
            }
        }

        composeRule.onNodeWithText("Log in with Discord").assertIsDisplayed()
    }

    @Test
    fun previewProSessionShowsMainDashboardTabs() {
        composeRule.setContent {
            WatchMeTheme {
                WatchMeApp(
                    token = "preview-pro",
                    statusMessage = mutableStateOf(null),
                    onOpenDiscordLogin = { _, _ -> },
                    onLogout = {},
                    onSaveProfile = { display, twitch, youtube, kick ->
                        WatchMeApi.saveProfile("preview-pro", display, twitch, youtube, kick)
                    },
                    onLoadProfile = { WatchMeApi.getProfile("preview-pro") },
                    onLiveSync = { WatchMeApi.liveSync("preview-pro") },
                    onLoadLiveStatus = { WatchMeApi.liveStatus("preview-pro") },
                    onLoadCreatorPostBuilder = { creatorId ->
                        WatchMeApi.getCreatorPostBuilder("preview-pro", creatorId)
                    },
                    onLoadGuildWorkspace = { guildId ->
                        WatchMeApi.getGuildWorkspace("preview-pro", guildId)
                    },
                    onLoadGuildChannels = { guildId ->
                        WatchMeApi.getGuildChannels("preview-pro", guildId)
                    },
                    onLoadGuildMembers = { guildId ->
                        WatchMeApi.getGuildMembers("preview-pro", guildId)
                    },
                    onSaveGuildConfig = { guildId, config ->
                        WatchMeApi.saveGuildConfig("preview-pro", guildId, config)
                    },
                    onAddGuildKeywordFilter = { guildId, platform, keyword ->
                        WatchMeApi.addGuildKeywordFilter("preview-pro", guildId, platform, keyword)
                    },
                    onRemoveGuildKeywordFilter = { guildId, platform, keyword ->
                        WatchMeApi.removeGuildKeywordFilter("preview-pro", guildId, platform, keyword)
                    },
                    onSaveCreatorTemplate = { creatorId, template ->
                        WatchMeApi.saveCreatorPostTemplate("preview-pro", creatorId, template)
                    },
                    onSaveCreatorConnection = { creatorId, connection ->
                        WatchMeApi.saveCreatorSocialConnection("preview-pro", creatorId, connection)
                    },
                    onPublishCreatorPost = { creatorId, template, scheduledAt ->
                        WatchMeApi.publishCreatorPost("preview-pro", creatorId, template, scheduledAt)
                    },
                    onLoadAutomationHome = { WatchMeApi.automationHome("preview-pro") },
                    onLoadAutomationActivity = { WatchMeApi.automationActivity("preview-pro") },
                    onLoadScheduledPosts = { creatorId ->
                        WatchMeApi.scheduledCreatorPosts("preview-pro", creatorId)
                    },
                    onRepostDispatch = { dispatchId ->
                        WatchMeApi.repostDispatch("preview-pro", dispatchId)
                    },
                    store = TokenStore(composeRule.activity),
                    activity = composeRule.activity,
                )
            }
        }

        composeRule.waitUntil(timeoutMillis = 5_000) {
            composeRule.onAllNodesWithText("Config").fetchSemanticsNodes().isNotEmpty() &&
                composeRule.onAllNodesWithText("Post Builder").fetchSemanticsNodes().isNotEmpty() &&
                composeRule.onAllNodesWithText("Socials").fetchSemanticsNodes().isNotEmpty()
        }
    }

}
