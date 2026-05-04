package com.watchme.app

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.Brush
import androidx.compose.material.icons.rounded.Collections
import androidx.compose.material.icons.rounded.Dashboard
import androidx.compose.material.icons.rounded.GroupAdd
import androidx.compose.material.icons.rounded.Link
import androidx.compose.material.icons.rounded.Schedule
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.Videocam
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import coil.request.ImageRequest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.text.DateFormat
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private enum class LibraryTab { IMAGES, VIDEOS }

private enum class MediaKind { IMAGE, VIDEO }

private const val WatchMeProPurchaseUrl = "https://pro.watchme-bot.com/#billing"
private const val WatchMeLiteDiscordInviteUrl = "https://discord.com/invite/watchme"
private const val WatchMeAppBuildLabel = "v1.0.5"

private enum class MainTab(
    val label: String,
    val icon: @Composable () -> Unit,
) {
    HOME(
        label = "Home",
        icon = { Icon(Icons.Rounded.Dashboard, contentDescription = "Home") },
    ),
    SOCIAL_GRAB(
        label = "Config",
        icon = { Icon(Icons.Rounded.Settings, contentDescription = "Channel selection") },
    ),
    POST_FAN(
        label = "Posts",
        icon = { Icon(Icons.Rounded.AutoAwesome, contentDescription = "Post builder") },
    ),
    MEMBER_REQUESTS(
        label = "Creators",
        icon = { Icon(Icons.Rounded.GroupAdd, contentDescription = "Creators") },
    ),
    BRANDING(
        label = "Branding",
        icon = { Icon(Icons.Rounded.Brush, contentDescription = "Server branding") },
    ),
    CONNECT_SOCIALS(
        label = "Socials",
        icon = { Icon(Icons.Rounded.Link, contentDescription = "Socials") },
    ),
}

private data class DiscordChannelPick(
    val id: String,
    val name: String,
)

private data class GuildMemberPick(
    val discordUserId: String,
    val displayName: String,
    val avatarUrl: String = "",
)

private data class KeywordFilterRow(
    val platform: String,
    val keyword: String,
)

private fun keywordRowsFromJson(obj: JSONObject): List<KeywordFilterRow> {
    val arr = obj.optJSONArray("keyword_filters") ?: return emptyList()
    return buildList {
        for (i in 0 until arr.length()) {
            val row = arr.optJSONObject(i) ?: continue
            val kw = row.optString("keyword").trim().lowercase()
            if (kw.isBlank()) continue
            add(
                KeywordFilterRow(
                    row.optString("platform", "all").ifBlank { "all" }.lowercase(),
                    kw,
                ),
            )
        }
    }.sortedWith(compareBy({ it.platform }, { it.keyword }))
}

private data class MediaLibraryItem(
    val uriString: String,
    val name: String,
    val mimeType: String,
    val detailLine: String,
    val kind: MediaKind,
    val durationMs: Long? = null,
) {
    val uri: Uri
        get() = Uri.parse(uriString)
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun WatchMeApp(
    token: String?,
    statusMessage: MutableState<String?>,
    onOpenDiscordLogin: (url: String, state: String) -> Unit,
    onLogout: () -> Unit,
    onSaveProfile: suspend (
        display: String?,
        twitch: String?,
        youtube: String?,
        kick: String?
    ) -> JSONObject,
    onLoadProfile: suspend () -> JSONObject,
    onLiveSync: suspend () -> JSONObject,
    onLoadLiveStatus: suspend () -> JSONObject,
    onLoadCreatorPostBuilder: suspend (creatorId: String) -> JSONObject,
    onLoadGuildWorkspace: suspend (guildId: String) -> JSONObject,
    onLoadGuildChannels: suspend (guildId: String) -> JSONObject,
    onLoadGuildMembers: suspend (guildId: String) -> JSONObject,
    onSaveGuildConfig: suspend (guildId: String, config: JSONObject) -> JSONObject,
    onAddGuildKeywordFilter: suspend (guildId: String, platform: String, keyword: String) -> JSONObject,
    onRemoveGuildKeywordFilter: suspend (guildId: String, platform: String, keyword: String) -> JSONObject,
    onSaveCreatorTemplate: suspend (creatorId: String, template: CreatorPostTemplate) -> JSONObject,
    onSaveCreatorConnection: suspend (creatorId: String, connection: CreatorSocialConnection) -> JSONObject,
    onPublishCreatorPost: suspend (creatorId: String, template: CreatorPostTemplate, scheduledAt: String?) -> JSONObject,
    onLoadAutomationHome: suspend () -> JSONObject,
    onLoadAutomationActivity: suspend () -> JSONObject,
    onLoadScheduledPosts: suspend (creatorId: String) -> JSONObject,
    onRepostDispatch: suspend (dispatchId: Long) -> JSONObject,
    store: TokenStore,
    activity: ComponentActivity,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val scope = rememberCoroutineScope()
    val status = statusMessage

    var activeTab by rememberSaveable { mutableStateOf(MainTab.HOME) }
    var socialRefreshTick by remember { mutableStateOf(0) }
    var proAccessUnlocked by rememberSaveable { mutableStateOf(false) }
    var liteDiscordInviteUrl by rememberSaveable { mutableStateOf(WatchMeLiteDiscordInviteUrl) }
    var accountMenuExpanded by remember { mutableStateOf(false) }
    var accountMenuName by rememberSaveable { mutableStateOf("Discord") }

    var displayName by remember { mutableStateOf("") }
    var twitch by remember { mutableStateOf("") }
    var youtube by remember { mutableStateOf("") }
    var kick by remember { mutableStateOf("") }
    var liveStatusSummary by remember { mutableStateOf("Sign in to check your live status.") }
    var automationHome by remember { mutableStateOf<JSONObject?>(null) }
    var automationActivity by remember { mutableStateOf(emptyList<AutomationActivityItem>()) }
    var scheduledServerPosts by remember { mutableStateOf(emptyList<CreatorDispatchRecord>()) }

    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                socialRefreshTick += 1
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
        }
    }

    var backgroundMonitor by remember { mutableStateOf(store.backgroundLiveMonitor) }
    var fastMonitor by remember { mutableStateOf(store.fastLiveMonitor) }

    var imageLibraryUris by remember { mutableStateOf(store.imageLibraryUris) }
    var videoLibraryUris by remember { mutableStateOf(store.videoLibraryUris) }
    var activeLibraryTab by rememberSaveable { mutableStateOf(LibraryTab.IMAGES) }

    val selectedImages = remember { mutableStateListOf<String>() }
    val selectedVideos = remember { mutableStateListOf<String>() }

    val imageItems by rememberMediaItems(context, imageLibraryUris, MediaKind.IMAGE)
    val videoItems by rememberMediaItems(context, videoLibraryUris, MediaKind.VIDEO)
    val selectedTotal = selectedImages.size + selectedVideos.size
    val libraryItemMap = remember(imageItems, videoItems) {
        (imageItems + videoItems).associateBy { it.uriString }
    }

    var creatorSyncId by remember { mutableStateOf(store.creatorStudioUserId.orEmpty()) }
    var availableGuilds by remember { mutableStateOf(emptyList<GuildOption>()) }
    var selectedGuildId by rememberSaveable { mutableStateOf(store.selectedGuildId.orEmpty()) }
    var selectedGuildName by rememberSaveable { mutableStateOf(store.selectedGuildName.orEmpty()) }
    var savedTemplates by remember { mutableStateOf(sortCreatorTemplates(store.creatorPostTemplates)) }
    var savedConnections by remember { mutableStateOf(sortCreatorConnections(store.creatorSocialConnections)) }
    var dispatchHistory by remember { mutableStateOf(sortCreatorDispatches(store.creatorDispatchHistory)) }
    var savedMemberRequests by remember { mutableStateOf(sortMemberRequests(store.memberRequests)) }

    val defaultTemplate = savedTemplates.firstOrNull { it.isDefault }

    var editingTemplateLocalId by rememberSaveable { mutableStateOf<String?>(defaultTemplate?.localId) }
    var editingTemplateRemoteId by rememberSaveable { mutableStateOf<Long?>(defaultTemplate?.remoteTemplateId) }
    var draftName by rememberSaveable { mutableStateOf(defaultTemplate?.name ?: "Quick post") }
    var draftPostText by rememberSaveable { mutableStateOf(defaultTemplate?.postText.orEmpty()) }
    var draftLinkUrl by rememberSaveable { mutableStateOf(defaultTemplate?.linkUrl.orEmpty()) }
    var draftIsDefault by rememberSaveable { mutableStateOf(defaultTemplate?.isDefault == true) }
    var draftMediaUris by remember {
        mutableStateOf(defaultTemplate?.mediaUris ?: emptyList())
    }
    val draftTargets = remember {
        mutableStateListOf<String>().apply {
            addAll(defaultTemplate?.targetPlatforms.orEmpty())
        }
    }

    var activeConnectionPlatform by rememberSaveable {
        mutableStateOf(savedConnections.firstOrNull()?.platform ?: CreatorStudioPlatforms.first())
    }
    var connectionAccountId by rememberSaveable { mutableStateOf("") }
    var connectionAccountName by rememberSaveable { mutableStateOf("") }
    var connectionStatus by rememberSaveable { mutableStateOf("active") }
    var connectionTokenExpiry by rememberSaveable { mutableStateOf("") }
    var connectionNotes by rememberSaveable { mutableStateOf("") }

    var scheduleDate by rememberSaveable { mutableStateOf("") }
    var scheduleTime by rememberSaveable { mutableStateOf("") }
    var scheduleTemplateLocalId by rememberSaveable { mutableStateOf(defaultTemplate?.localId) }
    var scheduleDraftName by rememberSaveable { mutableStateOf(defaultTemplate?.name ?: "Quick post") }
    var scheduleDraftPostText by rememberSaveable { mutableStateOf(defaultTemplate?.postText.orEmpty()) }
    var scheduleDraftLinkUrl by rememberSaveable { mutableStateOf(defaultTemplate?.linkUrl.orEmpty()) }
    var pageName by rememberSaveable { mutableStateOf("WatchMe Pro HQ") }
    var announceChannelId by rememberSaveable { mutableStateOf("") }
    var liveChannelId by rememberSaveable { mutableStateOf("") }
    var socialsFeedChannelId by rememberSaveable { mutableStateOf("") }
    var discordChannels by remember { mutableStateOf(emptyList<DiscordChannelPick>()) }
    var cooldownSeconds by rememberSaveable { mutableStateOf(600) }
    var autoCleanup by rememberSaveable { mutableStateOf(false) }
    var keywordFilterRows by remember { mutableStateOf(emptyList<KeywordFilterRow>()) }
    var keywordAddPlatform by rememberSaveable { mutableStateOf("all") }
    var keywordAddText by rememberSaveable { mutableStateOf("") }
    var brandName by rememberSaveable { mutableStateOf("WatchMe Pro") }
    var brandAccentHue by rememberSaveable { mutableStateOf(206f) }
    var brandAccentSaturation by rememberSaveable { mutableStateOf(0.72f) }
    var brandAccentBrightness by rememberSaveable { mutableStateOf(0.88f) }
    var brandEmbedTitle by rememberSaveable { mutableStateOf("WatchMe Pro Alert") }
    var brandCallToAction by rememberSaveable { mutableStateOf("Watch now") }
    var brandRoleMention by rememberSaveable { mutableStateOf("@everyone") }
    var brandFooter by rememberSaveable { mutableStateOf("Others notify, we automate.") }
    var brandLogoUrl by rememberSaveable { mutableStateOf("") }
    var previewImageUrl by rememberSaveable { mutableStateOf("") }
    var brandLogoLocalUri by rememberSaveable { mutableStateOf("") }
    var brandPreviewLocalUri by rememberSaveable { mutableStateOf("") }
    var brandDiscordPreviewVideoUri by rememberSaveable { mutableStateOf("") }
    var mentionMode by rememberSaveable { mutableStateOf("role") }

    var memberName by rememberSaveable { mutableStateOf("") }
    var memberPlatform by rememberSaveable { mutableStateOf("") }
    var memberNotes by rememberSaveable { mutableStateOf("") }
    var creatorTwitchUrl by rememberSaveable { mutableStateOf("") }
    var creatorYoutubeUrl by rememberSaveable { mutableStateOf("") }
    var creatorKickUrl by rememberSaveable { mutableStateOf("") }
    var creatorDisplayNickname by rememberSaveable { mutableStateOf("") }
    var creatorPingRoleId by rememberSaveable { mutableStateOf("") }
    var creatorPingMemberId by rememberSaveable { mutableStateOf("") }
    var rosterPickedDiscordUserId by rememberSaveable { mutableStateOf("") }
    var creatorManualDiscordId by rememberSaveable { mutableStateOf("") }
    var creatorPingTargetMode by rememberSaveable { mutableStateOf("both") }
    var oauthPendingPlatform by remember { mutableStateOf("") }

    var editingMemberRequestId by rememberSaveable { mutableStateOf<String?>(null) }

    var guildDiscordMembers by remember { mutableStateOf(emptyList<GuildMemberPick>()) }

    val selectedLibraryUris = (selectedImages.toList() + selectedVideos.toList()).distinct()
    val draftMediaItems = draftMediaUris.mapNotNull(libraryItemMap::get)
    val recentDispatches = dispatchHistory.take(4)
    val unlocked = token != null

    fun channelSummaryLabel(channelId: String): String {
        val id = channelId.trim()
        if (id.isEmpty()) return "Not set"
        val match = discordChannels.firstOrNull { it.id == id }
        return match?.let { "#${it.name}" } ?: id
    }

    fun persistCreatorId(next: String) {
        creatorSyncId = next
        store.creatorStudioUserId = next.trim().ifBlank { null }
    }

    fun persistSelectedGuild(id: String, name: String) {
        selectedGuildId = id.trim()
        selectedGuildName = name.trim()
        store.selectedGuildId = selectedGuildId.ifBlank { null }
        store.selectedGuildName = selectedGuildName.ifBlank { null }
    }

    fun persistTemplates(next: List<CreatorPostTemplate>) {
        val sorted = sortCreatorTemplates(next)
        savedTemplates = sorted
        store.creatorPostTemplates = sorted
    }

    fun persistConnections(next: List<CreatorSocialConnection>) {
        val sorted = sortCreatorConnections(next)
        savedConnections = sorted
        store.creatorSocialConnections = sorted
    }

    fun persistDispatches(next: List<CreatorDispatchRecord>) {
        val sorted = sortCreatorDispatches(next).take(20)
        dispatchHistory = sorted
        store.creatorDispatchHistory = sorted
    }

    fun persistMemberRequests(next: List<MemberRequestItem>) {
        val sorted = sortMemberRequests(next).take(24)
        savedMemberRequests = sorted
        store.memberRequests = sorted
    }

    fun workspaceConfigPayload(includeBranding: Boolean = true): JSONObject {
        val announce = announceChannelId.trim()
        val live = liveChannelId.trim().ifBlank { announce }
        val base = JSONObject()
            .put("announce_channel_id", announce)
            .put("live_channel_id", live)
            .put("socials_feed_channel_id", socialsFeedChannelId.trim())
            .put("cooldown_seconds", cooldownSeconds.coerceAtLeast(0))
            .put("auto_cleanup", autoCleanup)
            .put("mention_mode", mentionMode.trim().ifBlank { "role" })

        if (!includeBranding) {
            return base
        }

        val roleSnowflake = brandRoleMention.trim().removePrefix("<@&").removeSuffix(">").takeIf {
            val trimmed = brandRoleMention.trim()
            trimmed.isNotBlank() && !trimmed.startsWith("@")
        } ?: ""

        return base
            .put("brand_name", brandName.trim().ifBlank { pageName.trim() })
            .put("footer_text", brandFooter.trim())
            .put("brand_logo_url", brandLogoUrl.trim())
            .put("preview_image_url", previewImageUrl.trim())
            .put("live_role_id", roleSnowflake)
    }

    fun applyWorkspacePayload(payload: JSONObject) {
        val workspace = payload.optJSONObject("workspace") ?: payload
        val config = workspace.optJSONObject("config") ?: JSONObject()
        val branding = workspace.optJSONObject("branding") ?: JSONObject()

        fun JSONObject.cleanString(key: String): String = optString(key)
            .takeUnless { it.equals("null", ignoreCase = true) }
            .orEmpty()
            .trim()

        val serverBrandName = branding.cleanString("brand_name").ifBlank { config.cleanString("brand_name") }
        val serverFooter = branding.cleanString("footer_text").ifBlank { config.cleanString("footer_text") }
        val serverAnnounce = config.cleanString("announce_channel_id")
            .ifBlank { config.cleanString("live_channel_id") }
        val serverLive = config.cleanString("live_channel_id").ifBlank { serverAnnounce }
        val serverSocials = config.cleanString("socials_feed_channel_id")
        val serverLiveRole = config.cleanString("live_role_id")

        val filtersArray = workspace.optJSONArray("keyword_filters")
        keywordFilterRows = buildList {
            if (filtersArray != null) {
                for (i in 0 until filtersArray.length()) {
                    val item = filtersArray.optJSONObject(i) ?: continue
                    val kw = item.optString("keyword").trim().lowercase()
                    if (kw.isNotBlank()) {
                        val plat = item.optString("platform", "all").ifBlank { "all" }.lowercase()
                        add(KeywordFilterRow(plat, kw))
                    }
                }
            }
        }

        workspace.optJSONArray("creators")?.let { creatorsArray ->
            val remoteCreators = buildList {
                for (i in 0 until creatorsArray.length()) {
                    val item = creatorsArray.optJSONObject(i) ?: continue
                    val discordUserId = item.cleanString("discord_user_id")
                    val display = item.cleanString("display_name").ifBlank { discordUserId }
                    if (display.isBlank()) continue
                    val twitchUrl = item.cleanString("twitch_url")
                    val youtubeUrl = item.cleanString("youtube_url")
                    val kickUrl = item.cleanString("kick_url")
                    val previousExtras = savedMemberRequests.firstOrNull { existing ->
                        extractDiscordUserIdFromNotes(existing.notes).equals(discordUserId, ignoreCase = true)
                    }?.let { parseCreatorLinks(it.notes) }
                    val mergedNotes = mergeCreatorExtrasIntoNotesJson(
                        previous = previousExtras,
                        discordUserId = discordUserId,
                        twitchUrl = twitchUrl,
                        youtubeUrl = youtubeUrl,
                        kickUrl = kickUrl,
                        avatarUrl = item.cleanString("avatar_url"),
                        freeformNotes = previousExtras?.freeformNotes.orEmpty(),
                    )
                    val accessStatus = item.cleanString("access_status").ifBlank { "approved" }
                    add(
                        MemberRequestItem(
                            localId = "server-${selectedGuildId}-${discordUserId.ifBlank { display }}",
                            memberName = display,
                            requestType = "creator",
                            platform = primaryCreatorPlatformTag(
                                twitchUrl = twitchUrl,
                                youtubeUrl = youtubeUrl,
                                kickUrl = kickUrl,
                                fallbackPlatform = "discord",
                            ),
                            notes = mergedNotes,
                            status = if (accessStatus.equals("pending", ignoreCase = true)) {
                                "pending_approval"
                            } else {
                                "linked"
                            },
                            createdAtEpochMs = System.currentTimeMillis() - i,
                        ),
                    )
                }
            }
            if (remoteCreators.isNotEmpty()) {
                val remoteIds = remoteCreators.map { it.localId }.toSet()
                val localOnly = savedMemberRequests.filterNot { it.localId in remoteIds }
                persistMemberRequests(remoteCreators + localOnly)
            }
        }

        if (serverBrandName.isNotBlank()) {
            brandName = serverBrandName
            pageName = serverBrandName
        } else if (selectedGuildName.isNotBlank()) {
            brandName = selectedGuildName
            pageName = selectedGuildName
        }
        if (serverFooter.isNotBlank()) brandFooter = serverFooter

        announceChannelId = serverAnnounce
        liveChannelId = serverLive
        socialsFeedChannelId = serverSocials
        brandRoleMention = serverLiveRole
        if (config.has("cooldown_seconds")) {
            cooldownSeconds = config.optInt("cooldown_seconds", 600).coerceAtLeast(0)
        }
        if (config.has("auto_cleanup")) {
            autoCleanup = config.optBoolean("auto_cleanup")
        }

        brandLogoUrl = branding.cleanString("brand_logo_url").ifBlank { config.cleanString("brand_logo_url") }
        previewImageUrl =
            branding.cleanString("preview_image_url").ifBlank { config.cleanString("preview_image_url") }
        val mm = config.cleanString("mention_mode")
        if (mm.isNotBlank()) {
            mentionMode = mm
        }
    }

    fun saveWorkspaceConfig(includeBranding: Boolean, successMessage: String) {
        if (selectedGuildId.isBlank()) {
            status.value = "Choose a server before saving."
            return
        }
        scope.launch {
            runCatching {
                val payload = workspaceConfigPayload(includeBranding)
                val response = onSaveGuildConfig(selectedGuildId.trim(), payload)
                applyWorkspacePayload(response)
            }.onSuccess {
                status.value = successMessage
            }.onFailure { error ->
                status.value = error.message ?: "Server details could not be saved."
            }
        }
    }

    fun performLogout() {
        proAccessUnlocked = false
        store.proAccessUnlocked = false
        accountMenuExpanded = false
        onLogout()
        status.value = "Signed out."
    }

    fun loadDraft(template: CreatorPostTemplate) {
        editingTemplateLocalId = template.localId
        editingTemplateRemoteId = template.remoteTemplateId
        draftName = template.name
        draftPostText = template.postText
        draftLinkUrl = template.linkUrl
        draftIsDefault = template.isDefault
        draftMediaUris = template.mediaUris
        draftTargets.clear()
        draftTargets.addAll(template.targetPlatforms)
        activeTab = MainTab.POST_FAN
    }

    fun loadScheduleDraft(template: CreatorPostTemplate) {
        scheduleTemplateLocalId = template.localId
        scheduleDraftName = template.name
        scheduleDraftPostText = template.postText
        scheduleDraftLinkUrl = template.linkUrl
    }

    fun resetDraft() {
        editingTemplateLocalId = null
        editingTemplateRemoteId = null
        draftName = "Quick post"
        draftPostText = ""
        draftLinkUrl = ""
        draftIsDefault = false
        draftMediaUris = emptyList()
        draftTargets.clear()
    }

    fun currentDraftTemplate(): CreatorPostTemplate {
        return CreatorPostTemplate(
            localId = editingTemplateLocalId ?: "local-template-${System.currentTimeMillis()}",
            remoteTemplateId = editingTemplateRemoteId,
            name = draftName.trim().ifBlank { "Quick post" },
            postText = draftPostText.trim(),
            linkUrl = draftLinkUrl.trim(),
            mediaUris = draftMediaUris.filter(libraryItemMap::containsKey),
            targetPlatforms = normalizeCreatorPlatforms(draftTargets),
            isDefault = draftIsDefault,
            updatedAtEpochMs = System.currentTimeMillis(),
        )
    }

    fun saveTemplateLocally(template: CreatorPostTemplate): CreatorPostTemplate {
        val cleaned = savedTemplates.filterNot { it.localId == template.localId }
        val normalized = if (template.isDefault) {
            listOf(template) + cleaned.map { it.copy(isDefault = false) }
        } else {
            listOf(template) + cleaned
        }
        persistTemplates(normalized)
        return template
    }

    fun saveConnectionLocally(connection: CreatorSocialConnection): CreatorSocialConnection {
        val normalized = listOf(connection) + savedConnections.filterNot {
            it.platform == connection.platform
        }
        persistConnections(normalized)
        return connection
    }

    fun removeConnectionLocally(platform: String) {
        persistConnections(savedConnections.filterNot { it.platform == platform })
    }

    fun loadCreatorRequest(request: MemberRequestItem) {
        val links = parseCreatorLinks(request.notes)
        editingMemberRequestId = request.localId
        memberName = request.memberName
        creatorTwitchUrl = links.twitchUrl
        creatorYoutubeUrl = links.youtubeUrl
        creatorKickUrl = links.kickUrl
        memberNotes = links.freeformNotes
        creatorDisplayNickname = links.displayNickname
        creatorPingRoleId = links.pingRoleId
        creatorPingMemberId = links.pingMemberId
        val rid = extractDiscordUserIdFromNotes(request.notes).trim()
        if (rid.isNotBlank() && guildDiscordMembers.any { it.discordUserId == rid }) {
            rosterPickedDiscordUserId = rid
            creatorManualDiscordId = ""
        } else if (rid.isNotBlank()) {
            rosterPickedDiscordUserId = ""
            creatorManualDiscordId = rid
        } else {
            rosterPickedDiscordUserId = ""
            creatorManualDiscordId = ""
        }
        creatorPingTargetMode = when {
            links.pingRoleId.isNotBlank() && links.pingMemberId.isNotBlank() -> "both"
            links.pingRoleId.isNotBlank() -> "role"
            links.pingMemberId.isNotBlank() -> "member"
            else -> "both"
        }
        memberPlatform = primaryCreatorPlatformTag(
            twitchUrl = links.twitchUrl,
            youtubeUrl = links.youtubeUrl,
            kickUrl = links.kickUrl,
            fallbackPlatform = request.platform,
        )
    }

    fun clearCreatorRequestDraft() {
        editingMemberRequestId = null
        memberName = ""
        memberPlatform = ""
        creatorTwitchUrl = ""
        creatorYoutubeUrl = ""
        creatorKickUrl = ""
        memberNotes = ""
        creatorDisplayNickname = ""
        creatorPingRoleId = ""
        creatorPingMemberId = ""
        rosterPickedDiscordUserId = ""
        creatorManualDiscordId = ""
    }

    val imagePicker = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenMultipleDocuments(),
    ) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        persistReadAccess(context, uris)
        val merged = mergeRecentUris(imageLibraryUris, uris)
        imageLibraryUris = merged
        store.imageLibraryUris = merged
        draftMediaUris = (uris.map(Uri::toString) + draftMediaUris).distinct().take(8)
        activeLibraryTab = LibraryTab.IMAGES
        activeTab = MainTab.POST_FAN
        status.value = "${uris.size} image${pluralSuffix(uris.size)} added."
    }

    val videoPicker = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenMultipleDocuments(),
    ) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        persistReadAccess(context, uris)
        val merged = mergeRecentUris(videoLibraryUris, uris)
        videoLibraryUris = merged
        store.videoLibraryUris = merged
        draftMediaUris = (uris.map(Uri::toString) + draftMediaUris).distinct().take(8)
        activeLibraryTab = LibraryTab.VIDEOS
        activeTab = MainTab.POST_FAN
        status.value = "${uris.size} video${pluralSuffix(uris.size)} added."
    }

    val brandLogoPicker = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument(),
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        persistReadAccess(context, listOf(uri))
        brandLogoLocalUri = uri.toString()
    }

    val brandPreviewPicker = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument(),
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        persistReadAccess(context, listOf(uri))
        brandPreviewLocalUri = uri.toString()
    }

    val brandPreviewVideoPicker = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument(),
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        persistReadAccess(context, listOf(uri))
        brandDiscordPreviewVideoUri = uri.toString()
    }

    LaunchedEffect(imageLibraryUris) {
        selectedImages.retainAll(imageLibraryUris.toSet())
    }

    LaunchedEffect(videoLibraryUris) {
        selectedVideos.retainAll(videoLibraryUris.toSet())
    }

    LaunchedEffect(activeConnectionPlatform, savedConnections) {
        val existing = savedConnections.firstOrNull { it.platform == activeConnectionPlatform }
        if (existing != null) {
            connectionAccountId = existing.externalAccountId
            connectionAccountName = existing.externalAccountName
            connectionStatus = existing.status
            connectionTokenExpiry = existing.tokenExpiresAt
            connectionNotes = existing.notes
        } else {
            connectionAccountId = ""
            connectionAccountName = ""
            connectionStatus = "active"
            connectionTokenExpiry = ""
            connectionNotes = ""
        }
    }

    LaunchedEffect(token) {
        if (token == null) {
            displayName = ""
            twitch = ""
            youtube = ""
            kick = ""
            accountMenuExpanded = false
            accountMenuName = "Discord"
            availableGuilds = emptyList()
            proAccessUnlocked = false
            store.proAccessUnlocked = false
            backgroundMonitor = false
            fastMonitor = false
            liveStatusSummary = "Sign in to check your live status."
            activeTab = MainTab.SOCIAL_GRAB
            return@LaunchedEffect
        }

        proAccessUnlocked = false
        store.proAccessUnlocked = false
        backgroundMonitor = store.backgroundLiveMonitor
        fastMonitor = store.fastLiveMonitor

        try {
            val profile = onLoadProfile()
            fun jsonString(key: String): String {
                return profile.optString(key, "")
                    .takeUnless { it.equals("null", ignoreCase = true) }
                    .orEmpty()
            }
            displayName = jsonString("display_name")
            twitch = jsonString("twitch_url")
            youtube = jsonString("youtube_url")
            kick = jsonString("kick_url")
            val profileCreatorId = profile.optString("discord_user_id").ifBlank {
                profile.optJSONObject("identity")?.optString("discord_user_id").orEmpty()
            }
            if (profileCreatorId.isNotBlank()) {
                persistCreatorId(profileCreatorId)
            }
            accountMenuName = extractAccountName(profile)
                .takeUnless { it.equals("null", ignoreCase = true) || it.isBlank() }
                ?: "Discord"
            val guilds = mergeGuildOptions(
                extractGuildOptions(profile),
                selectedGuildId,
                selectedGuildName,
            )
            availableGuilds = guilds
            when {
                selectedGuildId.isBlank() && guilds.isNotEmpty() -> {
                    val firstGuild = guilds.first()
                    persistSelectedGuild(firstGuild.guildId, firstGuild.guildName)
                }
                selectedGuildId.isNotBlank() -> {
                    guilds.firstOrNull { it.guildId == selectedGuildId }?.let { selected ->
                        persistSelectedGuild(selected.guildId, selected.guildName)
                    }
                }
            }
            liteDiscordInviteUrl = extractLiteDiscordInviteUrl(profile)
            val isProMember = extractProAccess(profile)
            proAccessUnlocked = isProMember
            store.proAccessUnlocked = isProMember
            status.value = if (isProMember) {
                "Pro workspace unlocked."
            } else {
                "Pro workspace locked. This account is signed in but has no active Pro entitlement."
            }
        } catch (e: Exception) {
            proAccessUnlocked = false
            store.proAccessUnlocked = false
            status.value = "Signed in, but profile details could not be fully loaded: ${e.message}"
        }

        try {
            liveStatusSummary = formatLiveStatus(onLoadLiveStatus())
        } catch (_: Exception) {
            liveStatusSummary = "Live status is available after your next refresh."
        }
    }

    LaunchedEffect(token, selectedGuildId) {
        if (token.isNullOrBlank() || selectedGuildId.isBlank()) {
            discordChannels = emptyList()
            guildDiscordMembers = emptyList()
            return@LaunchedEffect
        }

        try {
            val channelPayload = onLoadGuildChannels(selectedGuildId.trim())
            val arr = channelPayload.optJSONArray("channels")
            discordChannels = buildList {
                if (arr != null) {
                    for (index in 0 until arr.length()) {
                        val ch = arr.optJSONObject(index) ?: continue
                        val id = ch.optString("id").trim()
                        val name = ch.optString("name").trim().ifBlank { id }
                        if (id.isNotBlank()) {
                            add(DiscordChannelPick(id, name))
                        }
                    }
                }
            }
        } catch (_: Exception) {
            discordChannels = emptyList()
        }

        try {
            val workspace = onLoadGuildWorkspace(selectedGuildId.trim())
            applyWorkspacePayload(workspace)
        } catch (error: Exception) {
            status.value = error.message ?: "Server details could not be loaded."
        }

        try {
            val memberPayload = onLoadGuildMembers(selectedGuildId.trim())
            val arr = memberPayload.optJSONArray("members")
            guildDiscordMembers = buildList {
                if (arr != null) {
                    for (index in 0 until arr.length()) {
                        val m = arr.optJSONObject(index) ?: continue
                        val id = m.optString("discord_user_id").trim()
                        val name = m.optString("display_name").trim().ifBlank { id }
                        if (id.isNotBlank()) {
                            add(
                                GuildMemberPick(
                                    discordUserId = id,
                                    displayName = name,
                                    avatarUrl = m.optString("avatar_url").trim(),
                                ),
                            )
                        }
                    }
                }
            }.sortedWith(compareBy { it.displayName.lowercase(Locale.getDefault()) })
        } catch (_: Exception) {
            guildDiscordMembers = emptyList()
        }
    }

    LaunchedEffect(token, creatorSyncId, socialRefreshTick) {
        if (token.isNullOrBlank()) {
            automationHome = null
            automationActivity = emptyList()
            scheduledServerPosts = emptyList()
            return@LaunchedEffect
        }

        try {
            val home = onLoadAutomationHome()
            automationHome = home
            automationActivity = home.optJSONArray("recent_activity")
                ?.let { array ->
                    buildList {
                        for (index in 0 until array.length()) {
                            val item = array.optJSONObject(index) ?: continue
                            add(AutomationActivityItem.fromJson(item))
                        }
                    }
                }
                .orEmpty()

            if (creatorSyncId.isNotBlank()) {
                val scheduledPayload = onLoadScheduledPosts(creatorSyncId.trim())
                scheduledServerPosts = scheduledPayload.optJSONArray("scheduled")
                    ?.let { array ->
                        buildList {
                            for (index in 0 until array.length()) {
                                val item = array.optJSONObject(index) ?: continue
                                add(CreatorDispatchRecord.fromApiJson(item, "Scheduled post"))
                            }
                        }
                    }
                    .orEmpty()
            }
        } catch (error: Exception) {
            status.value = error.message ?: "Automation status could not be loaded."
        }

        if (creatorSyncId.isBlank()) return@LaunchedEffect

        try {
            val builder = onLoadCreatorPostBuilder(creatorSyncId.trim())
            val remoteTemplates = builder.optJSONArray("templates")
                ?.let { array ->
                    buildList {
                        for (index in 0 until array.length()) {
                            val item = array.optJSONObject(index) ?: continue
                            add(CreatorPostTemplate.fromApiJson(item))
                        }
                    }
                }
                .orEmpty()
            val remoteConnections = builder.optJSONArray("connections")
                ?.let { array ->
                    buildList {
                        for (index in 0 until array.length()) {
                            val item = array.optJSONObject(index) ?: continue
                            add(CreatorSocialConnection.fromApiJson(item))
                        }
                    }
                }
                .orEmpty()

            persistTemplates(sortCreatorTemplates(remoteTemplates))
            persistConnections(sortCreatorConnections(remoteConnections))
        } catch (_: Exception) {
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = Color(0xFF09111F),
                    titleContentColor = Color(0xFFE5EDF8),
                    actionIconContentColor = Color(0xFF9FB0C8),
                    navigationIconContentColor = Color(0xFF9FB0C8),
                ),
                title = {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        WatchMeLogoBadge(compact = true, contentDescription = "WatchMe Pro")
                        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(if (unlocked) activeTab.label else "WatchMe Pro")
                            if (unlocked) {
                                Text(
                                    text = "WatchMe Pro",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = Color(0xFF9FB0C8),
                                )
                            }
                        }
                    }
                },
                actions = {
                    if (token != null) {
                        Box {
                            TextButton(onClick = { accountMenuExpanded = true }) {
                                Text(
                                    text = accountMenuName,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    color = Color(0xFF7C9CFF),
                                )
                            }
                            DropdownMenu(
                                expanded = accountMenuExpanded,
                                onDismissRequest = { accountMenuExpanded = false },
                            ) {
                                DropdownMenuItem(
                                    text = { Text(accountMenuName) },
                                    onClick = {},
                                    enabled = false,
                                )
                                DropdownMenuItem(
                                    text = {
                                        Text(selectedGuildName.ifBlank { selectedGuildId.ifBlank { "No guild selected" } })
                                    },
                                    onClick = {},
                                    enabled = false,
                                )
                                DropdownMenuItem(
                                    text = { Text("Account") },
                                    onClick = {
                                        accountMenuExpanded = false
                                        status.value = "Account tools will land in the next pass."
                                    },
                                )
                                DropdownMenuItem(
                                    text = { Text("Socials") },
                                    onClick = {
                                        activeTab = MainTab.CONNECT_SOCIALS
                                        accountMenuExpanded = false
                                    },
                                )
                                DropdownMenuItem(
                                    text = { Text("Sign out") },
                                    onClick = {
                                        accountMenuExpanded = false
                                        performLogout()
                                    },
                                )
                            }
                        }
                    }
                },
            )
        },
        bottomBar = {
            if (unlocked) {
                NavigationBar(
                    modifier = Modifier.animateContentSize(),
                    containerColor = Color(0xFF09111F),
                    contentColor = Color(0xFF9FB0C8),
                ) {
                    MainTab.entries.forEach { tab ->
                        NavigationBarItem(
                            selected = activeTab == tab,
                            onClick = { activeTab = tab },
                            icon = { tab.icon() },
                            label = {
                                Text(
                                    text = tab.label,
                                    maxLines = 1,
                                    softWrap = false,
                                    overflow = TextOverflow.Clip,
                                    fontSize = 10.sp,
                                )
                            },
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = Color(0xFFAFC1FF),
                                selectedTextColor = Color(0xFFAFC1FF),
                                indicatorColor = Color(0x667C9CFF),
                                unselectedIconColor = Color(0xFF6B7A90),
                                unselectedTextColor = Color(0xFF6B7A90),
                            ),
                        )
                    }
                }
            }
        },
        containerColor = Color.Transparent,
    ) { inner ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        colors = listOf(
                            Color(0xFF050912),
                            Color(0xFF08101D),
                        ),
                    ),
                )
                .padding(inner),
        ) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.radialGradient(
                            colors = listOf(
                                Color(0x2E2563EB),
                                Color.Transparent,
                            ),
                            center = androidx.compose.ui.geometry.Offset(120f, 80f),
                            radius = 520f,
                        ),
                    ),
            )
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.radialGradient(
                            colors = listOf(
                                Color(0x29EF4444),
                                Color.Transparent,
                            ),
                            center = androidx.compose.ui.geometry.Offset(980f, 120f),
                            radius = 500f,
                        ),
                    ),
            )
            if (!unlocked) {
                LockedEntryScreen(
                    token = token,
                    proAccessUnlocked = proAccessUnlocked,
                    statusMessage = status.value,
                    onLogin = {
                        scope.launch {
                            try {
                                val (url, state) = WatchMeApi.startDiscordAuth()
                                onOpenDiscordLogin(url, state)
                                status.value = "Continue Discord sign-in to return to WatchMe Pro."
                            } catch (e: Exception) {
                                status.value = e.message
                            }
                        }
                    },
                    onOpenPayPal = {
                        openExternalUrl(context, WatchMeProPurchaseUrl)
                        status.value = "Pro purchase opened. Log in again after the backend confirms access."
                    },
                    onOpenLiteDiscord = {
                        openExternalUrl(context, liteDiscordInviteUrl)
                        status.value = "Lite Discord invite opened."
                    },
                    onLogout = ::performLogout,
                )
            } else {
                val contentScrollState = rememberScrollState()
                LaunchedEffect(activeTab) {
                    contentScrollState.scrollTo(0)
                }
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .verticalScroll(contentScrollState)
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    status.value
                        ?.takeUnless { it.contains("verified", ignoreCase = true) }
                        ?.takeUnless { it.contains("workspace unlocked", ignoreCase = true) }
                        ?.let { StatusCard(message = it) }

                    when (activeTab) {
                        MainTab.HOME -> {
                            AutomationHomeSection(
                                home = automationHome,
                                activity = automationActivity,
                                scheduledPosts = scheduledServerPosts,
                                token = token,
                                liveStatusSummary = liveStatusSummary,
                                backgroundMonitor = backgroundMonitor,
                                fastMonitor = fastMonitor,
                                onRefreshAutomation = {
                                    scope.launch {
                                        try {
                                            automationHome = onLoadAutomationHome()
                                            automationActivity = automationHome
                                                ?.optJSONArray("recent_activity")
                                                ?.let { array ->
                                                    buildList {
                                                        for (index in 0 until array.length()) {
                                                            val item = array.optJSONObject(index) ?: continue
                                                            add(AutomationActivityItem.fromJson(item))
                                                        }
                                                    }
                                                }
                                                .orEmpty()
                                            status.value = "Automation status refreshed."
                                        } catch (error: Exception) {
                                            status.value = error.message ?: "Automation status could not be refreshed."
                                        }
                                    }
                                },
                                onRefreshLiveStatus = {
                                    scope.launch {
                                        try {
                                            liveStatusSummary = formatLiveStatus(onLoadLiveStatus())
                                            status.value = "Live status refreshed."
                                        } catch (error: Exception) {
                                            status.value = error.message ?: "Live status could not be refreshed."
                                        }
                                    }
                                },
                                onSyncLive = {
                                    scope.launch {
                                        try {
                                            onLiveSync()
                                            liveStatusSummary = formatLiveStatus(onLoadLiveStatus())
                                            status.value = "Synced with WatchMe."
                                        } catch (error: Exception) {
                                            status.value = error.message ?: "Sync failed."
                                        }
                                    }
                                },
                                onBackgroundMonitorChanged = { next ->
                                    backgroundMonitor = next
                                    store.backgroundLiveMonitor = next
                                    LiveMonitorScheduler.applyModes(activity, store)
                                },
                                onFastMonitorChanged = { next ->
                                    fastMonitor = next
                                    store.fastLiveMonitor = next
                                    LiveMonitorScheduler.applyModes(activity, store)
                                },
                                onPostNow = { activeTab = MainTab.POST_FAN },
                                onBoostLast = {
                                    val dispatchId = dispatchHistory.firstOrNull {
                                        it.remoteDispatchId != null
                                    }?.remoteDispatchId
                                    if (dispatchId == null) {
                                        status.value = "No server dispatch is ready to boost yet."
                                    } else {
                                        scope.launch {
                                            try {
                                                onRepostDispatch(dispatchId)
                                                status.value = "Boost queued."
                                            } catch (error: Exception) {
                                                status.value = error.message ?: "Boost could not be queued."
                                            }
                                        }
                                    }
                                },
                            )
                        }
                        MainTab.POST_FAN -> {
                            WatchMeAppPostFanTab(
                                token = token,
                                creatorSyncId = creatorSyncId,
                                scope = scope,
                                status = status,
                                displayName = displayName,
                                selectedGuildName = selectedGuildName,
                                announceSummary = channelSummaryLabel(announceChannelId),
                                socialsSummary = channelSummaryLabel(socialsFeedChannelId),
                                draftName = draftName,
                                onDraftNameChange = { draftName = it },
                                draftPostText = draftPostText,
                                onDraftPostTextChange = { draftPostText = it },
                                draftLinkUrl = draftLinkUrl,
                                onDraftLinkUrlChange = { draftLinkUrl = it },
                                draftTargets = draftTargets,
                                draftIsDefault = draftIsDefault,
                                onDraftDefaultChange = { draftIsDefault = !draftIsDefault },
                                draftMediaItems = draftMediaItems,
                                onPickImages = { imagePicker.launch(arrayOf("image/*")) },
                                onPickVideos = { videoPicker.launch(arrayOf("video/*")) },
                                onClearAttached = { draftMediaUris = emptyList() },
                                onRemoveDraftMedia = { uriString ->
                                    draftMediaUris = draftMediaUris.filterNot { it == uriString }
                                },
                                editingTemplateLocalId = editingTemplateLocalId,
                                setEditingTemplateLocalId = { editingTemplateLocalId = it },
                                setEditingTemplateRemoteId = { editingTemplateRemoteId = it },
                                saveTemplateLocally = ::saveTemplateLocally,
                                currentDraftTemplate = ::currentDraftTemplate,
                                persistTemplates = ::persistTemplates,
                                savedTemplates = savedTemplates,
                                onSaveCreatorTemplate = onSaveCreatorTemplate,
                                persistDispatches = ::persistDispatches,
                                dispatchHistory = dispatchHistory,
                                onPublishCreatorPost = onPublishCreatorPost,
                                prependScheduledServerPost = { remoteDispatch ->
                                    scheduledServerPosts =
                                        listOf(remoteDispatch) + scheduledServerPosts
                                },
                                onResetDraft = ::resetDraft,
                                brandName = brandName,
                                brandEmbedTitle = brandEmbedTitle,
                                brandCallToAction = brandCallToAction,
                                brandRoleMention = brandRoleMention,
                                brandFooter = brandFooter,
                                brandAccentColor = Color.hsv(
                                    hue = brandAccentHue,
                                    saturation = brandAccentSaturation,
                                    value = brandAccentBrightness,
                                ),
                                scheduleDate = scheduleDate,
                                onScheduleDateChange = { scheduleDate = it },
                                scheduleTime = scheduleTime,
                                onScheduleTimeChange = { scheduleTime = it },
                                scheduleTemplateLocalId = scheduleTemplateLocalId,
                                onScheduleTemplateLocalIdSelected = { selectedLocalId ->
                                    savedTemplates.firstOrNull {
                                        it.localId == selectedLocalId
                                    }?.let(::loadScheduleDraft)
                                        ?: run { scheduleTemplateLocalId = selectedLocalId }
                                },
                                scheduleDraftName = scheduleDraftName,
                                onScheduleDraftNameChange = { scheduleDraftName = it },
                                scheduleDraftPostText = scheduleDraftPostText,
                                onScheduleDraftPostTextChange = { scheduleDraftPostText = it },
                                scheduleDraftLinkUrl = scheduleDraftLinkUrl,
                                onScheduleDraftLinkUrlChange = { scheduleDraftLinkUrl = it },
                            )
                        }

                        MainTab.SOCIAL_GRAB -> {
                            WatchMeAppSocialGrabTab(
                                availableGuilds = availableGuilds,
                                selectedGuildId = selectedGuildId,
                                selectedGuildName = selectedGuildName,
                                onGuildPicked = { guild ->
                                    persistSelectedGuild(guild.guildId, guild.guildName)
                                    status.value = "Managing ${guild.guildName}."
                                },
                                onSelectedGuildNameChange = { selectedGuildName = it },
                                onSaveGuildSelection = {
                                    persistSelectedGuild(selectedGuildId, selectedGuildName)
                                    status.value = if (selectedGuildName.isNotBlank() || selectedGuildId.isNotBlank()) {
                                        "Guild selection saved."
                                    } else {
                                        "Guild selection cleared."
                                    }
                                },
                                pageName = pageName,
                                onPageNameChange = { pageName = it },
                                discordChannels = discordChannels,
                                announceChannelId = announceChannelId,
                                onAnnounceChannelIdChange = { announceChannelId = it },
                                liveChannelId = liveChannelId,
                                onLiveChannelIdChange = { liveChannelId = it },
                                socialsFeedChannelId = socialsFeedChannelId,
                                onSocialsFeedChannelIdChange = { socialsFeedChannelId = it },
                                cooldownSeconds = cooldownSeconds,
                                onCooldownSecondsChange = { next -> cooldownSeconds = next.coerceAtLeast(0) },
                                autoCleanup = autoCleanup,
                                onAutoCleanupChange = { autoCleanup = it },
                                keywordFilterRows = keywordFilterRows,
                                onKeywordFilterRowsChange = { keywordFilterRows = it },
                                keywordAddPlatform = keywordAddPlatform,
                                onKeywordAddPlatformChange = { keywordAddPlatform = it },
                                keywordAddText = keywordAddText,
                                onKeywordAddTextChange = { keywordAddText = it },
                                scope = scope,
                                token = token,
                                status = status,
                                onAddGuildKeywordFilter = onAddGuildKeywordFilter,
                                onRemoveGuildKeywordFilter = onRemoveGuildKeywordFilter,
                                onSaveLiveRouting = {
                                    saveWorkspaceConfig(
                                        includeBranding = true,
                                        successMessage = "Live channel routing saved.",
                                    )
                                },
                                onSaveCooldownCleanup = {
                                    saveWorkspaceConfig(
                                        includeBranding = false,
                                        successMessage = "Cooldown & cleanup saved.",
                                    )
                                },
                            )
                        }

                        MainTab.BRANDING -> {
                            BrandingControlsSection(
                                brandName = brandName,
                                onBrandNameChange = { brandName = it },
                                brandAccentHue = brandAccentHue,
                                onBrandAccentHueChange = { brandAccentHue = it },
                                brandAccentSaturation = brandAccentSaturation,
                                onBrandAccentSaturationChange = { brandAccentSaturation = it },
                                brandAccentBrightness = brandAccentBrightness,
                                onBrandAccentBrightnessChange = { brandAccentBrightness = it },
                                brandEmbedTitle = brandEmbedTitle,
                                onBrandEmbedTitleChange = { brandEmbedTitle = it },
                                brandCallToAction = brandCallToAction,
                                onBrandCallToActionChange = { brandCallToAction = it },
                                brandRoleMention = brandRoleMention,
                                onBrandRoleMentionChange = { brandRoleMention = it },
                                brandFooter = brandFooter,
                                onBrandFooterChange = { brandFooter = it },
                                brandLogoUrl = brandLogoUrl,
                                previewImageUrl = previewImageUrl,
                                brandLogoLocalUri = brandLogoLocalUri,
                                brandPreviewLocalUri = brandPreviewLocalUri,
                                brandDiscordPreviewVideoUri = brandDiscordPreviewVideoUri,
                                onPickBrandLogo = { brandLogoPicker.launch(arrayOf("image/*")) },
                                onPickBanner = { brandPreviewPicker.launch(arrayOf("image/*")) },
                                onPickDiscordClip = { brandPreviewVideoPicker.launch(arrayOf("video/*")) },
                                onClearBrandLogo = { brandLogoLocalUri = "" },
                                onClearBrandBanner = { brandPreviewLocalUri = "" },
                                onClearDiscordClip = { brandDiscordPreviewVideoUri = "" },
                                mentionMode = mentionMode,
                                onMentionModeChange = { mentionMode = it },
                                brandAssetCount = draftMediaItems.size,
                                selectedGuildName = selectedGuildName,
                                announceChannel = channelSummaryLabel(announceChannelId),
                                previewText = draftPostText,
                                previewLinkUrl = draftLinkUrl,
                                onAddImages = { imagePicker.launch(arrayOf("image/*")) },
                                onAddVideos = { videoPicker.launch(arrayOf("video/*")) },
                                onSave = {
                                    displayName = brandName
                                    saveWorkspaceConfig(
                                        includeBranding = true,
                                        successMessage = "Server branding saved.",
                                    )
                                },
                            )
                        }

                        MainTab.CONNECT_SOCIALS -> {
                            SocialConnectionsSection(
                                savedConnections = savedConnections,
                                pendingPlatform = oauthPendingPlatform,
                                onConnect = { platform ->
                                    scope.launch {
                                        oauthPendingPlatform = platform
                                        try {
                                            val currentToken = token ?: throw IllegalStateException("Not logged in")
                                            val response = WatchMeApi.startSocialOAuth(currentToken, platform)
                                            val authorizeUrl = response.optString("authorize_url").trim()
                                            if (authorizeUrl.isBlank()) {
                                                throw IllegalStateException("No OAuth URL returned.")
                                            }
                                            if (openExternalUrl(context, authorizeUrl)) {
                                                status.value = "Continue ${platformDisplayName(platform)} sign-in in your browser."
                                            } else {
                                                status.value = "Could not open ${platformDisplayName(platform)} sign-in."
                                            }
                                        } catch (error: Exception) {
                                            status.value = error.message ?: "${platformDisplayName(platform)} sign-in could not start."
                                        } finally {
                                            oauthPendingPlatform = ""
                                        }
                                    }
                                },
                                onDisconnect = { platform ->
                                    scope.launch {
                                        try {
                                            val currentToken = token ?: throw IllegalStateException("Not logged in")
                                            WatchMeApi.disconnectSocialConnection(currentToken, platform)
                                            removeConnectionLocally(platform)
                                            socialRefreshTick += 1
                                            status.value = "${platformDisplayName(platform)} disconnected."
                                        } catch (error: Exception) {
                                            status.value = error.message ?: "${platformDisplayName(platform)} disconnect failed."
                                        }
                                    }
                                },
                                onSelectPage = { platform, pageId ->
                                    scope.launch {
                                        try {
                                            val currentToken = token ?: throw IllegalStateException("Not logged in")
                                            WatchMeApi.selectSocialPage(currentToken, platform, pageId)
                                            socialRefreshTick += 1
                                            status.value = "${platformDisplayName(platform)} page connected."
                                        } catch (error: Exception) {
                                            status.value = error.message ?: "${platformDisplayName(platform)} page selection failed."
                                        }
                                    }
                                },
                            )
                        }

                        MainTab.MEMBER_REQUESTS -> {
                            CreatorRosterSection(
                                guildCreatorRoster = guildDiscordMembers,
                                selectedRosterDiscordId = rosterPickedDiscordUserId,
                                onPickGuildMember = { pick ->
                                    rosterPickedDiscordUserId = pick.discordUserId
                                    memberName = pick.displayName.ifBlank { pick.discordUserId }
                                    creatorManualDiscordId = ""
                                },
                                onClearGuildMemberPick = {
                                    rosterPickedDiscordUserId = ""
                                    creatorManualDiscordId = ""
                                },
                                manualDiscordUserId = creatorManualDiscordId,
                                onManualDiscordUserIdChange = { next ->
                                    creatorManualDiscordId = next
                                    if (next.isNotBlank()) {
                                        rosterPickedDiscordUserId = ""
                                    }
                                },
                                pingTargetMode = creatorPingTargetMode,
                                onPingTargetModeChange = { creatorPingTargetMode = it },
                                memberName = memberName,
                                onMemberNameChange = { next ->
                                    val changed = next != memberName
                                    if (changed) {
                                        rosterPickedDiscordUserId = ""
                                    }
                                    memberName = next
                                },
                                displayNickname = creatorDisplayNickname,
                                onDisplayNicknameChange = { creatorDisplayNickname = it },
                                pingRoleId = creatorPingRoleId,
                                onPingRoleIdChange = { creatorPingRoleId = it },
                                pingMemberId = creatorPingMemberId,
                                onPingMemberIdChange = { creatorPingMemberId = it },
                                twitchUrl = creatorTwitchUrl,
                                onTwitchUrlChange = { creatorTwitchUrl = it },
                                youtubeUrl = creatorYoutubeUrl,
                                onYoutubeUrlChange = { creatorYoutubeUrl = it },
                                kickUrl = creatorKickUrl,
                                onKickUrlChange = { creatorKickUrl = it },
                                memberNotes = memberNotes,
                                onMemberNotesChange = { memberNotes = it },
                                memberRequests = savedMemberRequests,
                                editingMemberRequestId = editingMemberRequestId,
                                onSaveLinked = {
                                    if (memberName.isBlank()) {
                                        status.value = "Add a creator name before saving."
                                    } else {
                                        scope.launch {
                                            try {
                                                val displayForServer =
                                                    creatorDisplayNickname.trim().ifBlank { memberName.trim() }
                                                val creatorProfileId = resolveCreatorProfileId(
                                                    selectedGuildId = selectedGuildId,
                                                    editingLocalId = editingMemberRequestId,
                                                    rosterDiscordUserId = rosterPickedDiscordUserId,
                                                    manualDiscordSnowflake = creatorManualDiscordId,
                                                    memberName = memberName,
                                                    twitchUrl = creatorTwitchUrl,
                                                    youtubeUrl = creatorYoutubeUrl,
                                                    kickUrl = creatorKickUrl,
                                                )
                                                val persistedAvatar = editingMemberRequestId?.let { lid ->
                                                    savedMemberRequests.firstOrNull { it.localId == lid }
                                                        ?.let { parseCreatorLinks(it.notes).avatarUrl }
                                                }.orEmpty()
                                                val pickedAvatar = guildDiscordMembers
                                                    .firstOrNull { it.discordUserId.trim() == creatorProfileId.trim() }
                                                    ?.avatarUrl
                                                    .orEmpty()
                                                val savedAvatar = pickedAvatar.ifBlank { persistedAvatar }
                                                token?.takeIf { selectedGuildId.isNotBlank() }
                                                    ?.let { session ->
                                                        WatchMeApi.saveGuildCreatorProfile(
                                                            session,
                                                            selectedGuildId.trim(),
                                                            creatorProfileId,
                                                            displayForServer,
                                                            creatorTwitchUrl.trim(),
                                                            creatorYoutubeUrl.trim(),
                                                            creatorKickUrl.trim(),
                                                            "approved",
                                                        )
                                                    }
                                                val summaryPlatform = primaryCreatorPlatformTag(
                                                    twitchUrl = creatorTwitchUrl,
                                                    youtubeUrl = creatorYoutubeUrl,
                                                    kickUrl = creatorKickUrl,
                                                    fallbackPlatform = "",
                                                )
                                                val request = MemberRequestItem(
                                                    localId = "server-${selectedGuildId}-${creatorProfileId}",
                                                    memberName = memberName.trim(),
                                                    requestType = "creator",
                                                    platform = summaryPlatform,
                                                    notes = buildCreatorLinksJson(
                                                        twitchUrl = creatorTwitchUrl,
                                                        youtubeUrl = creatorYoutubeUrl,
                                                        kickUrl = creatorKickUrl,
                                                        discordUserId = creatorProfileId,
                                                        displayNickname = creatorDisplayNickname,
                                                        pingRoleId = creatorPingRoleId,
                                                        pingMemberId = creatorPingMemberId,
                                                        avatarUrl = savedAvatar,
                                                        freeformNotes = memberNotes,
                                                    ),
                                                    status = "linked",
                                                )
                                                persistMemberRequests(listOf(request) + savedMemberRequests.filterNot {
                                                    it.localId == request.localId
                                                })
                                                clearCreatorRequestDraft()
                                                status.value = "Linked member saved to WatchMe."
                                            } catch (error: Exception) {
                                                status.value = error.message ?: "Creator could not be saved."
                                            }
                                        }
                                    }
                                },
                                onSavePending = {
                                    if (memberName.isBlank()) {
                                        status.value = "Add a creator name before saving."
                                    } else {
                                        scope.launch {
                                            try {
                                                val displayForServer =
                                                    creatorDisplayNickname.trim().ifBlank { memberName.trim() }
                                                val creatorProfileId = resolveCreatorProfileId(
                                                    selectedGuildId = selectedGuildId,
                                                    editingLocalId = editingMemberRequestId,
                                                    rosterDiscordUserId = rosterPickedDiscordUserId,
                                                    manualDiscordSnowflake = creatorManualDiscordId,
                                                    memberName = memberName,
                                                    twitchUrl = creatorTwitchUrl,
                                                    youtubeUrl = creatorYoutubeUrl,
                                                    kickUrl = creatorKickUrl,
                                                )
                                                val persistedAvatar = editingMemberRequestId?.let { lid ->
                                                    savedMemberRequests.firstOrNull { it.localId == lid }
                                                        ?.let { parseCreatorLinks(it.notes).avatarUrl }
                                                }.orEmpty()
                                                val pickedAvatar = guildDiscordMembers
                                                    .firstOrNull { it.discordUserId.trim() == creatorProfileId.trim() }
                                                    ?.avatarUrl
                                                    .orEmpty()
                                                val savedAvatar = pickedAvatar.ifBlank { persistedAvatar }
                                                token?.takeIf { selectedGuildId.isNotBlank() }
                                                    ?.let { session ->
                                                        WatchMeApi.saveGuildCreatorProfile(
                                                            session,
                                                            selectedGuildId.trim(),
                                                            creatorProfileId,
                                                            displayForServer,
                                                            creatorTwitchUrl.trim(),
                                                            creatorYoutubeUrl.trim(),
                                                            creatorKickUrl.trim(),
                                                            "pending",
                                                        )
                                                    }
                                                val summaryPlatform = primaryCreatorPlatformTag(
                                                    twitchUrl = creatorTwitchUrl,
                                                    youtubeUrl = creatorYoutubeUrl,
                                                    kickUrl = creatorKickUrl,
                                                    fallbackPlatform = "",
                                                )
                                                val request = MemberRequestItem(
                                                    localId = "server-${selectedGuildId}-${creatorProfileId}",
                                                    memberName = memberName.trim(),
                                                    requestType = "creator",
                                                    platform = summaryPlatform,
                                                    notes = buildCreatorLinksJson(
                                                        twitchUrl = creatorTwitchUrl,
                                                        youtubeUrl = creatorYoutubeUrl,
                                                        kickUrl = creatorKickUrl,
                                                        discordUserId = creatorProfileId,
                                                        displayNickname = creatorDisplayNickname,
                                                        pingRoleId = creatorPingRoleId,
                                                        pingMemberId = creatorPingMemberId,
                                                        avatarUrl = savedAvatar,
                                                        freeformNotes = memberNotes,
                                                    ),
                                                    status = "pending_approval",
                                                )
                                                persistMemberRequests(listOf(request) + savedMemberRequests.filterNot {
                                                    it.localId == request.localId
                                                })
                                                clearCreatorRequestDraft()
                                                status.value = "Pending creator saved to WatchMe."
                                            } catch (error: Exception) {
                                                status.value = error.message ?: "Creator could not be saved."
                                            }
                                        }
                                    }
                                },
                                onEditRequest = ::loadCreatorRequest,
                                onApproveRequest = { request ->
                                    persistMemberRequests(
                                        listOf(request.copy(status = "linked")) + savedMemberRequests.filterNot {
                                            it.localId == request.localId
                                        },
                                    )
                                    status.value = "${request.memberName} linked."
                                },
                                onMoveToPending = { request ->
                                    persistMemberRequests(
                                        listOf(request.copy(status = "pending_approval")) + savedMemberRequests.filterNot {
                                            it.localId == request.localId
                                        },
                                    )
                                    status.value = "${request.memberName} moved to pending approval."
                                },
                                onRemoveRequest = { request ->
                                    persistMemberRequests(
                                        savedMemberRequests.filterNot { it.localId == request.localId },
                                    )
                                    if (editingMemberRequestId == request.localId) {
                                        clearCreatorRequestDraft()
                                    }
                                    status.value = "Creator removed."
                                },
                                onClearDraft = ::clearCreatorRequestDraft,
                            )
                        }

                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun WatchMeAppPostFanTab(
    token: String?,
    creatorSyncId: String,
    scope: CoroutineScope,
    status: MutableState<String?>,
    displayName: String,
    selectedGuildName: String,
    announceSummary: String,
    socialsSummary: String,
    draftName: String,
    onDraftNameChange: (String) -> Unit,
    draftPostText: String,
    onDraftPostTextChange: (String) -> Unit,
    draftLinkUrl: String,
    onDraftLinkUrlChange: (String) -> Unit,
    draftTargets: MutableList<String>,
    draftIsDefault: Boolean,
    onDraftDefaultChange: () -> Unit,
    draftMediaItems: List<MediaLibraryItem>,
    onPickImages: () -> Unit,
    onPickVideos: () -> Unit,
    onClearAttached: () -> Unit,
    onRemoveDraftMedia: (String) -> Unit,
    editingTemplateLocalId: String?,
    setEditingTemplateLocalId: (String?) -> Unit,
    setEditingTemplateRemoteId: (Long?) -> Unit,
    saveTemplateLocally: (CreatorPostTemplate) -> CreatorPostTemplate,
    currentDraftTemplate: () -> CreatorPostTemplate,
    persistTemplates: (List<CreatorPostTemplate>) -> Unit,
    savedTemplates: List<CreatorPostTemplate>,
    onSaveCreatorTemplate: suspend (String, CreatorPostTemplate) -> JSONObject,
    persistDispatches: (List<CreatorDispatchRecord>) -> Unit,
    dispatchHistory: List<CreatorDispatchRecord>,
    onPublishCreatorPost: suspend (String, CreatorPostTemplate, String?) -> JSONObject,
    prependScheduledServerPost: (CreatorDispatchRecord) -> Unit,
    onResetDraft: () -> Unit,
    brandName: String,
    brandEmbedTitle: String,
    brandCallToAction: String,
    brandRoleMention: String,
    brandFooter: String,
    brandAccentColor: Color,
    scheduleDate: String,
    onScheduleDateChange: (String) -> Unit,
    scheduleTime: String,
    onScheduleTimeChange: (String) -> Unit,
    scheduleTemplateLocalId: String?,
    onScheduleTemplateLocalIdSelected: (String) -> Unit,
    scheduleDraftName: String,
    onScheduleDraftNameChange: (String) -> Unit,
    scheduleDraftPostText: String,
    onScheduleDraftPostTextChange: (String) -> Unit,
    scheduleDraftLinkUrl: String,
    onScheduleDraftLinkUrlChange: (String) -> Unit,
) {
    CreatorComposerSection(
        draftName = draftName,
        onDraftNameChange = onDraftNameChange,
        draftPostText = draftPostText,
        onDraftPostTextChange = onDraftPostTextChange,
        draftLinkUrl = draftLinkUrl,
        onDraftLinkUrlChange = onDraftLinkUrlChange,
        draftTargets = draftTargets,
        draftIsDefault = draftIsDefault,
        onDraftDefaultChange = onDraftDefaultChange,
        draftMediaItems = draftMediaItems,
        onAddImages = onPickImages,
        onAddVideos = onPickVideos,
        onClearAttached = onClearAttached,
        onRemoveDraftMedia = onRemoveDraftMedia,
        editingTemplateLocalId = editingTemplateLocalId,
        onSaveTemplate = {
            val localTemplate = saveTemplateLocally(currentDraftTemplate())
            setEditingTemplateLocalId(localTemplate.localId)
            setEditingTemplateRemoteId(localTemplate.remoteTemplateId)
            status.value = "Template saved locally."

            if (token != null && creatorSyncId.isNotBlank()) {
                scope.launch {
                    try {
                        val response = onSaveCreatorTemplate(creatorSyncId.trim(), localTemplate)
                        val remoteTemplate =
                            response.optJSONObject("template")
                                ?.let(CreatorPostTemplate::fromApiJson)
                                ?.copy(
                                    localId = localTemplate.localId,
                                    updatedAtEpochMs = System.currentTimeMillis(),
                                )
                                ?: localTemplate
                        persistTemplates(
                            mergeRemoteTemplates(savedTemplates, listOf(remoteTemplate)),
                        )
                        setEditingTemplateRemoteId(remoteTemplate.remoteTemplateId)
                        status.value = "Template saved and synced."
                    } catch (_: Exception) {
                        status.value =
                            "Template saved locally. Remote sync can plug in when the new routes are ready."
                    }
                }
            }
        },
        onQueuePublish = {
            val draft = currentDraftTemplate()
            if (draft.targetPlatforms.isEmpty()) {
                status.value = "Pick at least one target before queueing the post."
            } else {
                val localDispatch = CreatorDispatchRecord(
                    templateName = draft.name,
                    postText = draft.postText,
                    linkUrl = draft.linkUrl,
                    mediaUris = draft.mediaUris,
                    targetPlatforms = draft.targetPlatforms,
                    status = "saved_local",
                    note = "Saved in the mobile queue",
                )
                persistDispatches(listOf(localDispatch) + dispatchHistory)
                status.value = "Publish request saved locally."

                if (token != null && creatorSyncId.isNotBlank()) {
                    scope.launch {
                        try {
                            val response = onPublishCreatorPost(
                                creatorSyncId.trim(),
                                draft,
                                null,
                            )
                            val remoteDispatch =
                                response.optJSONObject("dispatch")
                                    ?.let {
                                        CreatorDispatchRecord.fromApiJson(
                                            it,
                                            draft.name,
                                        )
                                    }
                                    ?.copy(
                                        localId = localDispatch.localId,
                                        createdAtEpochMs = localDispatch.createdAtEpochMs,
                                    )
                                    ?: localDispatch.copy(
                                        status = "queued",
                                        note = "Queued on WatchMe server",
                                    )
                            persistDispatches(
                                listOf(remoteDispatch) + dispatchHistory.filterNot {
                                    it.localId == localDispatch.localId
                                },
                            )
                            status.value = "Publish request queued on WatchMe."
                        } catch (_: Exception) {
                            status.value =
                                "Publish request is saved locally. Server queue wiring can attach next."
                        }
                    }
                }
            }
        },
        onResetDraft = onResetDraft,
    )
    SchedulePlannerSection(
        scheduleDate = scheduleDate,
        onScheduleDateChange = onScheduleDateChange,
        scheduleTime = scheduleTime,
        onScheduleTimeChange = onScheduleTimeChange,
        savedTemplates = savedTemplates,
        selectedTemplateLocalId = scheduleTemplateLocalId,
        onSelectedTemplateLocalIdChange = onScheduleTemplateLocalIdSelected,
        scheduleDraftName = scheduleDraftName,
        onScheduleDraftNameChange = onScheduleDraftNameChange,
        scheduleDraftPostText = scheduleDraftPostText,
        onScheduleDraftPostTextChange = onScheduleDraftPostTextChange,
        scheduleDraftLinkUrl = scheduleDraftLinkUrl,
        onScheduleDraftLinkUrlChange = onScheduleDraftLinkUrlChange,
        dispatchHistory = dispatchHistory,
        onSchedulePost = {
            val baseTemplate = savedTemplates.firstOrNull {
                it.localId == scheduleTemplateLocalId
            } ?: currentDraftTemplate()
            val scheduledTemplate = baseTemplate.copy(
                name = scheduleDraftName.trim().ifBlank { baseTemplate.name },
                postText = scheduleDraftPostText.trim(),
                linkUrl = scheduleDraftLinkUrl.trim(),
                updatedAtEpochMs = System.currentTimeMillis(),
            )
            if (scheduledTemplate.postText.isBlank() && scheduledTemplate.mediaUris.isEmpty()) {
                status.value = "Pick or save a template before scheduling."
            } else if (scheduleDate.isBlank() || scheduleTime.isBlank()) {
                status.value = "Add a date and time before scheduling."
            } else {
                val scheduledEpochMs = scheduleEpochMillisOrNow(scheduleDate, scheduleTime)
                val scheduledPost = CreatorDispatchRecord(
                    templateName = scheduledTemplate.name,
                    postText = scheduledTemplate.postText,
                    linkUrl = scheduledTemplate.linkUrl,
                    mediaUris = scheduledTemplate.mediaUris,
                    targetPlatforms = scheduledTemplate.targetPlatforms,
                    status = "scheduled_local",
                    note = "Scheduled for ${scheduleDate.trim()} at ${scheduleTime.trim()}",
                    createdAtEpochMs = scheduledEpochMs,
                )
                persistDispatches(listOf(scheduledPost) + dispatchHistory)
                status.value =
                    "Post saved for ${prettyDateLabel(parseIsoDateOrToday(scheduleDate))} at ${scheduleTime.trim()}."
                if (token != null && creatorSyncId.isNotBlank()) {
                    scope.launch {
                        try {
                            val scheduledAt =
                                java.time.Instant.ofEpochMilli(scheduledEpochMs).toString()
                            val response = onPublishCreatorPost(
                                creatorSyncId.trim(),
                                scheduledTemplate,
                                scheduledAt,
                            )
                            val remoteDispatch = response.optJSONObject("dispatch")?.let {
                                CreatorDispatchRecord.fromApiJson(
                                    it,
                                    scheduledTemplate.name,
                                )
                            }
                            if (remoteDispatch != null) {
                                prependScheduledServerPost(remoteDispatch)
                            }
                            status.value = "Post scheduled on WatchMe."
                        } catch (error: Exception) {
                            status.value =
                                error.message ?: "Post saved locally. Server schedule failed."
                        }
                    }
                }
            }
        },
    )
    LivePostBuilderSection(
        selectedGuildName = selectedGuildName,
        announceChannel = announceSummary,
        postChannel = socialsSummary,
        draftTargets = draftTargets,
        draftPostText = draftPostText,
        draftLinkUrl = draftLinkUrl,
        draftMediaCount = draftMediaItems.size,
        dispatchCount = dispatchHistory.count {
            it.status == "queued" || it.status == "saved_local"
        },
        onQueueLivePost = {
            if (draftPostText.isBlank() && draftMediaItems.isEmpty()) {
                status.value = "Build the live post first."
            } else {
                val draft = currentDraftTemplate()
                val liveDispatch = CreatorDispatchRecord(
                    templateName = draft.name.ifBlank { "Live post" },
                    postText = draft.postText,
                    linkUrl = draft.linkUrl,
                    mediaUris = draft.mediaUris,
                    targetPlatforms = draft.targetPlatforms,
                    status = "queued",
                    note = "Queued from live post builder",
                    createdAtEpochMs = System.currentTimeMillis(),
                )
                persistDispatches(listOf(liveDispatch) + dispatchHistory)
                status.value = "Live post queued."
            }
        },
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun WatchMeAppSocialGrabTab(
    availableGuilds: List<GuildOption>,
    selectedGuildId: String,
    selectedGuildName: String,
    onGuildPicked: (GuildOption) -> Unit,
    onSelectedGuildNameChange: (String) -> Unit,
    onSaveGuildSelection: () -> Unit,
    pageName: String,
    onPageNameChange: (String) -> Unit,
    discordChannels: List<DiscordChannelPick>,
    announceChannelId: String,
    onAnnounceChannelIdChange: (String) -> Unit,
    liveChannelId: String,
    onLiveChannelIdChange: (String) -> Unit,
    socialsFeedChannelId: String,
    onSocialsFeedChannelIdChange: (String) -> Unit,
    cooldownSeconds: Int,
    onCooldownSecondsChange: (Int) -> Unit,
    autoCleanup: Boolean,
    onAutoCleanupChange: (Boolean) -> Unit,
    keywordFilterRows: List<KeywordFilterRow>,
    onKeywordFilterRowsChange: (List<KeywordFilterRow>) -> Unit,
    keywordAddPlatform: String,
    onKeywordAddPlatformChange: (String) -> Unit,
    keywordAddText: String,
    onKeywordAddTextChange: (String) -> Unit,
    scope: CoroutineScope,
    token: String?,
    status: MutableState<String?>,
    onAddGuildKeywordFilter: suspend (String, String, String) -> JSONObject,
    onRemoveGuildKeywordFilter: suspend (String, String, String) -> JSONObject,
    onSaveLiveRouting: () -> Unit,
    onSaveCooldownCleanup: () -> Unit,
) {
    GuildConfigSection(
        availableGuilds = availableGuilds,
        selectedGuildId = selectedGuildId,
        selectedGuildName = selectedGuildName,
        onGuildSelected = onGuildPicked,
        onSelectedGuildNameChange = onSelectedGuildNameChange,
        onSaveGuild = onSaveGuildSelection,
    )
    ConfigLiveStreamingSection(
        pageName = pageName,
        onPageNameChange = onPageNameChange,
        channels = discordChannels,
        announceChannelId = announceChannelId,
        onAnnounceChannelIdChange = onAnnounceChannelIdChange,
        liveChannelId = liveChannelId,
        onLiveChannelIdChange = onLiveChannelIdChange,
        socialsFeedChannelId = socialsFeedChannelId,
        onSocialsFeedChannelIdChange = onSocialsFeedChannelIdChange,
        onSave = onSaveLiveRouting,
    )
    ConfigModerationSection(
        cooldownSeconds = cooldownSeconds,
        onCooldownSecondsChange = onCooldownSecondsChange,
        autoCleanup = autoCleanup,
        onAutoCleanupChange = onAutoCleanupChange,
        keywordRows = keywordFilterRows,
        keywordAddPlatform = keywordAddPlatform,
        onKeywordAddPlatformChange = onKeywordAddPlatformChange,
        keywordAddText = keywordAddText,
        onKeywordAddTextChange = onKeywordAddTextChange,
        onAddKeyword = {
            val gid = selectedGuildId.trim()
            val tokenLocal = token
            val kw = keywordAddText.trim()
            when {
                gid.isBlank() || tokenLocal.isNullOrBlank() -> {
                    status.value = "Choose a server and stay signed in."
                }
                kw.isBlank() -> {
                    status.value = "Enter a keyword to add."
                }
                else -> {
                    scope.launch {
                        runCatching {
                            val response = onAddGuildKeywordFilter(
                                gid,
                                keywordAddPlatform.ifBlank { "all" },
                                kw,
                            )
                            onKeywordFilterRowsChange(keywordRowsFromJson(response))
                            onKeywordAddTextChange("")
                            status.value = "Keyword saved."
                        }.onFailure { err ->
                            status.value = err.message ?: "Keyword could not be saved."
                        }
                    }
                }
            }
        },
        onRemoveKeyword = { row ->
            val gid = selectedGuildId.trim()
            val tokenLocal = token
            when {
                gid.isBlank() || tokenLocal.isNullOrBlank() -> {
                    status.value = "Choose a server and stay signed in."
                }
                else -> {
                    scope.launch {
                        runCatching {
                            val response = onRemoveGuildKeywordFilter(gid, row.platform, row.keyword)
                            onKeywordFilterRowsChange(keywordRowsFromJson(response))
                            status.value = "Keyword removed."
                        }.onFailure { err ->
                            status.value =
                                err.message ?: "Keyword could not be removed."
                        }
                    }
                }
            }
        },
        onSaveAutomation = onSaveCooldownCleanup,
    )
    SaveConfigSection(
        onSaveConfig = {
            onSaveLiveRouting()
            onSaveCooldownCleanup()
        },
        onTestPost = {
            onSaveLiveRouting()
            status.value = "Test post is handled from the Pro dashboard for now."
        },
    )
}

@Composable
private fun LockedEntryScreen(
    token: String?,
    proAccessUnlocked: Boolean,
    statusMessage: String?,
    onLogin: () -> Unit,
    onOpenPayPal: () -> Unit,
    onOpenLiteDiscord: () -> Unit,
    onLogout: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Surface(
            shape = RoundedCornerShape(32.dp),
            tonalElevation = 4.dp,
            color = MaterialTheme.colorScheme.surface.copy(alpha = 0.96f),
        ) {
            Column(
                modifier = Modifier.padding(horizontal = 24.dp, vertical = 28.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                WatchMeVerifiedMark()
                if (token == null) {
                    Button(
                        onClick = onLogin,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        PlatformLogoImage(
                            platform = "discord",
                            compact = true,
                            contentDescription = "Discord logo",
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Log in with Discord")
                    }
                } else if (!proAccessUnlocked) {
                    FilledTonalButton(
                        onClick = onOpenPayPal,
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.filledTonalButtonColors(
                            containerColor = MaterialTheme.colorScheme.secondaryContainer,
                            contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
                        ),
                    ) {
                        PlatformLogoImage(
                            platform = "paypal",
                            compact = true,
                            contentDescription = "PayPal logo",
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Buy WatchMe Pro")
                    }
                    FilledTonalButton(
                        onClick = onOpenLiteDiscord,
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.filledTonalButtonColors(
                            containerColor = MaterialTheme.colorScheme.surfaceVariant,
                            contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
                        ),
                    ) {
                        PlatformLogoImage(
                            platform = "discord",
                            compact = true,
                            contentDescription = "Discord logo",
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Join WatchMe Lite Discord")
                    }
                }
                statusMessage?.let { StatusCard(message = it) }
                if (token != null) {
                    TextButton(onClick = onLogout) {
                        Text("Sign out")
                    }
                }
            }
        }
    }
}

@Composable
private fun GateStatusRow(
    label: String,
    platform: String,
    complete: Boolean,
    completeText: String,
    pendingText: String,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            PlatformLogoImage(
                platform = platform,
                active = complete,
                contentDescription = "$label logo",
            )
            Column(modifier = Modifier.weight(1f)) {
                Text(text = label, style = MaterialTheme.typography.titleSmall)
                Text(
                    text = if (complete) completeText else pendingText,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun PostFanOverviewCard(
    selectedGuildName: String,
    creatorSyncId: String,
    dispatchCount: Int,
) {
    SectionCard(
        title = "Posts",
        subtitle = "",
    ) {
        InfoLine("Managing guild", selectedGuildName.ifBlank { "Choose in Config" })
        InfoLine("Creator ID", creatorSyncId.ifBlank { "Not linked yet" })
        InfoLine("Send queue", dispatchCount.toString())
    }
}

@Composable
private fun ConfigOverviewCard(
    selectedGuildName: String,
    pageName: String,
    announceChannel: String,
    postChannel: String,
) {
    SectionCard(
        title = "Config",
        subtitle = "",
    ) {
        InfoLine("Guild", selectedGuildName.ifBlank { "No guild selected" })
        InfoLine("Page", pageName)
        InfoLine("Alerts", announceChannel)
        InfoLine("Posts", postChannel)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun GuildConfigSection(
    availableGuilds: List<GuildOption>,
    selectedGuildId: String,
    selectedGuildName: String,
    onGuildSelected: (GuildOption) -> Unit,
    onSelectedGuildNameChange: (String) -> Unit,
    onSaveGuild: () -> Unit,
) {
    val showSwitcher = false
    val resolvedName = selectedGuildName.ifBlank {
        availableGuilds.firstOrNull { it.guildId == selectedGuildId }?.guildName.orEmpty()
    }
    SectionCard(
        title = "Server",
        subtitle = "",
    ) {
        when {
            showSwitcher -> {
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    availableGuilds.forEach { guild ->
                        FilterChip(
                            selected = guild.guildId == selectedGuildId,
                            onClick = { onGuildSelected(guild) },
                            label = { Text(guild.guildName) },
                        )
                    }
                }
            }

            resolvedName.isNotBlank() -> {
                OutlinedTextField(
                    value = resolvedName,
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("Assigned billing server") },
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            else -> {
                EmptyLibraryCard(
                    title = "No guild linked",
                    body = "Refresh workspace after Discord login.",
                )
            }
        }
        if (showSwitcher || resolvedName.isBlank()) {
            OutlinedTextField(
                value = selectedGuildName,
                onValueChange = onSelectedGuildNameChange,
                label = { Text("Friendly server label") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        if (showSwitcher || resolvedName.isBlank()) {
            FilledTonalButton(
                onClick = onSaveGuild,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Save server")
            }
        }
    }
}

@Composable
private fun DiscordChannelPicker(
    label: String,
    channels: List<DiscordChannelPick>,
    selectedId: String,
    onSelectedIdChange: (String) -> Unit,
) {
    Column(modifier = Modifier.fillMaxWidth()) {
        if (channels.isEmpty()) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(modifier = Modifier.height(4.dp))
            OutlinedTextField(
                value = selectedId,
                onValueChange = onSelectedIdChange,
                label = { Text("Channel ID") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            return
        }
        var pickerOpen by remember { mutableStateOf(false) }
        var query by remember { mutableStateOf("") }
        val summaryText = when {
            selectedId.isBlank() -> ""
            else -> channels.firstOrNull { it.id == selectedId }
                ?.let { ch -> "${ch.name}" }
                ?: selectedId
        }
        OutlinedTextField(
            value = if (selectedId.isBlank()) "" else "#$summaryText",
            onValueChange = {},
            readOnly = true,
            label = { Text(label) },
            placeholder = { Text("Choose channel") },
            trailingIcon = {
                Row {
                    if (selectedId.isNotBlank()) {
                        TextButton(onClick = { onSelectedIdChange("") }) {
                            Text("Clear")
                        }
                    }
                    TextButton(onClick = { pickerOpen = true }) {
                        Text("Choose")
                    }
                }
            },
            modifier = Modifier
                .fillMaxWidth()
                .clickable { pickerOpen = true },
        )
        if (pickerOpen) {
            AlertDialog(
                onDismissRequest = {
                    pickerOpen = false
                    query = ""
                },
                confirmButton = {
                    TextButton(
                        onClick = {
                            pickerOpen = false
                            query = ""
                        },
                    ) {
                        Text("Close")
                    }
                },
                title = { Text(label) },
                text = {
                    Column(modifier = Modifier.fillMaxWidth()) {
                        OutlinedTextField(
                            value = query,
                            onValueChange = { query = it },
                            label = { Text("Search") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        val filtered = channels.filter { ch ->
                            query.isBlank() ||
                                ch.name.contains(query, ignoreCase = true) ||
                                ch.id.contains(query, ignoreCase = true)
                        }
                        LazyColumn(
                            modifier = Modifier
                                .fillMaxWidth()
                                .heightIn(max = 320.dp),
                        ) {
                            items(filtered, key = { it.id }) { ch ->
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clickable {
                                            onSelectedIdChange(ch.id)
                                            pickerOpen = false
                                            query = ""
                                        }
                                        .padding(vertical = 12.dp, horizontal = 4.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                                ) {
                                    Text(
                                        text = "#",
                                        style = MaterialTheme.typography.titleMedium,
                                        color = MaterialTheme.colorScheme.primary,
                                        fontWeight = FontWeight.Bold,
                                    )
                                    Text(
                                        text = ch.name,
                                        style = MaterialTheme.typography.bodyLarge,
                                        modifier = Modifier.weight(1f),
                                        maxLines = 2,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                }
                                HorizontalDivider()
                            }
                        }
                    }
                },
            )
        }
    }
}

private fun channelLabel(
    channels: List<DiscordChannelPick>,
    selectedId: String,
): String = when {
    selectedId.isBlank() -> "Not selected"
    else -> channels.firstOrNull { it.id == selectedId }
        ?.let { "#${it.name}" }
        ?: selectedId
}

@Composable
private fun ConfigLiveStreamingSection(
    pageName: String,
    onPageNameChange: (String) -> Unit,
    channels: List<DiscordChannelPick>,
    announceChannelId: String,
    onAnnounceChannelIdChange: (String) -> Unit,
    liveChannelId: String,
    onLiveChannelIdChange: (String) -> Unit,
    socialsFeedChannelId: String,
    onSocialsFeedChannelIdChange: (String) -> Unit,
    onSave: () -> Unit,
) {
    StepSectionCard(
        step = 1,
        title = "Select channels",
        subtitle = "",
    ) {
        OutlinedTextField(
            value = pageName,
            onValueChange = onPageNameChange,
            label = { Text("Workspace label") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(modifier = Modifier.height(12.dp))
        DiscordChannelPicker(
            label = "Streaming channel",
            channels = channels,
            selectedId = announceChannelId,
            onSelectedIdChange = onAnnounceChannelIdChange,
        )
        Spacer(modifier = Modifier.height(12.dp))
        DiscordChannelPicker(
            label = "Relay channel",
            channels = channels,
            selectedId = liveChannelId,
            onSelectedIdChange = onLiveChannelIdChange,
        )
        Spacer(modifier = Modifier.height(12.dp))
        DiscordChannelPicker(
            label = "Social Grab channel",
            channels = channels,
            selectedId = socialsFeedChannelId,
            onSelectedIdChange = onSocialsFeedChannelIdChange,
        )
    }
}

@Composable
private fun ConfigModerationSection(
    cooldownSeconds: Int,
    onCooldownSecondsChange: (Int) -> Unit,
    autoCleanup: Boolean,
    onAutoCleanupChange: (Boolean) -> Unit,
    keywordRows: List<KeywordFilterRow>,
    keywordAddPlatform: String,
    onKeywordAddPlatformChange: (String) -> Unit,
    keywordAddText: String,
    onKeywordAddTextChange: (String) -> Unit,
    onAddKeyword: () -> Unit,
    onRemoveKeyword: (KeywordFilterRow) -> Unit,
    onSaveAutomation: () -> Unit,
) {
    StepSectionCard(
        step = 2,
        title = "Cleanup, cooldown, and keywords",
        subtitle = "",
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "Auto cleanup",
                style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.weight(1f),
            )
            Switch(
                checked = autoCleanup,
                onCheckedChange = onAutoCleanupChange,
            )
        }
        OutlinedTextField(
            value = cooldownSeconds.toString(),
            onValueChange = { next ->
                val digits = next.filter { it.isDigit() }.take(7)
                val parsed = digits.toIntOrNull()
                if (parsed != null) {
                    onCooldownSecondsChange(parsed.coerceIn(0, 86_400))
                }
            },
            label = { Text("Cooldown (seconds)") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            modifier = Modifier.fillMaxWidth(),
        )
        Text(
            text = "Keywords",
            style = MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.onSurface,
        )
        if (keywordRows.isEmpty()) {
            Text(
                text = "No saved keywords yet.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                keywordRows.forEach { row ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = row.keyword,
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.SemiBold,
                            )
                            Text(
                                text = row.platform,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        TextButton(onClick = { onRemoveKeyword(row) }) {
                            Text("Remove")
                        }
                    }
                }
            }
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedTextField(
                value = keywordAddPlatform,
                onValueChange = onKeywordAddPlatformChange,
                label = { Text("Platform") },
                singleLine = true,
                modifier = Modifier.weight(1f),
            )
            OutlinedTextField(
                value = keywordAddText,
                onValueChange = onKeywordAddTextChange,
                label = { Text("Keyword") },
                singleLine = true,
                modifier = Modifier.weight(1f),
            )
        }
        FilledTonalButton(
            onClick = onAddKeyword,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Add keyword")
        }
    }
}

@Composable
private fun SaveConfigSection(
    onSaveConfig: () -> Unit,
    onTestPost: () -> Unit,
) {
    StepSectionCard(
        step = 3,
        title = "Save config",
        subtitle = "Save once the setup looks right. Test post is optional if you want to check the result straight away.",
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            FilledTonalButton(onClick = onSaveConfig, modifier = Modifier.weight(1f)) {
                Text("Save config")
            }
            FilledTonalButton(onClick = onTestPost, modifier = Modifier.weight(1f)) {
                Text("Test post")
            }
        }
    }
}

@Composable
private fun AppPathwaysSection(
    onOpenLibrary: () -> Unit,
    onOpenBrand: () -> Unit,
    onOpenSocials: () -> Unit,
    onOpenMembers: () -> Unit,
) {
    SectionCard(
        title = "What WatchMe focuses on",
        subtitle = "This build is the framework for the app paths: home, login, Pro unlock, dashboard tabs, and on-the-fly creator work.",
    ) {
        PathwayCard(
            title = "Post Fan builder",
            body = "Draft quick posts, attach selected media, save templates, and queue or schedule ideas locally first.",
        )
        PathwayCard(
            title = "Image and video library",
            body = "Keep reusable clips, thumbnails, posters, and creator shots ready for easier mobile selections.",
            actionLabel = "Open Library",
            onAction = onOpenLibrary,
        )
        PathwayCard(
            title = "Branding path",
            body = "Check the creator identity, default post voice, active assets, and API route before posting.",
            actionLabel = "Open Brand",
            onAction = onOpenBrand,
        )
        PathwayCard(
            title = "Social connection path",
            body = "Track where this creator posts so publishing routes have a clean place to plug in later.",
            actionLabel = "Open Socials",
            onAction = onOpenSocials,
        )
        PathwayCard(
            title = "Member request path",
            body = "Capture quick member asks while moving, then sort them when the full backend is ready.",
            actionLabel = "Open Members",
            onAction = onOpenMembers,
        )
    }
}

@Composable
private fun PathwayCard(
    title: String,
    body: String,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.62f),
        shape = RoundedCornerShape(20.dp),
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.Bold,
            )
            Text(
                text = body,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (actionLabel != null && onAction != null) {
                TextButton(onClick = onAction) {
                    Text(actionLabel)
                }
            }
        }
    }
}

@Composable
private fun SocialGrabOverviewCard(imageCount: Int, videoCount: Int, selectedCount: Int) {
    SectionCard(
        title = "Library",
        subtitle = "Manage the quick-access image and video stash you want available on your phone.",
    ) {
        InfoLine("Images", imageCount.toString())
        InfoLine("Videos", videoCount.toString())
        InfoLine("Selected", selectedCount.toString())
    }
}

@Composable
private fun BrandingOverviewCard(
    displayName: String,
    creatorSyncId: String,
    defaultTemplate: CreatorPostTemplate?,
    imageCount: Int,
    videoCount: Int,
    selectedCount: Int,
    liveStatusSummary: String,
) {
    SectionCard(
        title = "Branding",
        subtitle = "",
    ) {
        InfoLine("Name", displayName.ifBlank { "WatchMe Pro" })
        InfoLine("Template", defaultTemplate?.name ?: "None")
        InfoLine("Assets", "${imageCount + videoCount}")
        InfoLine("Selected", selectedCount.toString())
        InfoLine("Live label", liveStatusSummary)
    }
}

@Composable
private fun BrandingAssetRow(
    title: String,
    localUri: String,
    remoteUrl: String,
    onPick: () -> Unit,
    onClearLocal: () -> Unit,
) {
    val context = LocalContext.current
    val model = localUri.trim().takeIf { it.isNotBlank() }
        ?: remoteUrl.trim().takeIf { it.startsWith("http", ignoreCase = true) }
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.SemiBold,
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Surface(
                modifier = Modifier.size(76.dp),
                shape = RoundedCornerShape(22.dp),
                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.65f),
                border = BorderStroke(1.dp, Color(0x337C9CFF)),
            ) {
                if (model != null) {
                    AsyncImage(
                        model = ImageRequest.Builder(context).data(model).crossfade(true).build(),
                        contentDescription = title,
                        modifier = Modifier.fillMaxSize(),
                        contentScale = ContentScale.Crop,
                    )
                } else {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            text = "WM",
                            style = MaterialTheme.typography.titleLarge,
                            color = MaterialTheme.colorScheme.primary,
                            fontWeight = FontWeight.Black,
                        )
                    }
                }
            }
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilledTonalButton(onClick = onPick) {
                        Text("Choose")
                    }
                    if (localUri.isNotBlank()) {
                        TextButton(onClick = onClearLocal) {
                            Text("Clear pick")
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun BrandingControlsSection(
    brandName: String,
    onBrandNameChange: (String) -> Unit,
    brandAccentHue: Float,
    onBrandAccentHueChange: (Float) -> Unit,
    brandAccentSaturation: Float,
    onBrandAccentSaturationChange: (Float) -> Unit,
    brandAccentBrightness: Float,
    onBrandAccentBrightnessChange: (Float) -> Unit,
    brandEmbedTitle: String,
    onBrandEmbedTitleChange: (String) -> Unit,
    brandCallToAction: String,
    onBrandCallToActionChange: (String) -> Unit,
    brandRoleMention: String,
    onBrandRoleMentionChange: (String) -> Unit,
    brandFooter: String,
    onBrandFooterChange: (String) -> Unit,
    brandLogoUrl: String,
    previewImageUrl: String,
    brandLogoLocalUri: String,
    brandPreviewLocalUri: String,
    brandDiscordPreviewVideoUri: String,
    onPickBrandLogo: () -> Unit,
    onPickBanner: () -> Unit,
    onPickDiscordClip: () -> Unit,
    onClearBrandLogo: () -> Unit,
    onClearBrandBanner: () -> Unit,
    onClearDiscordClip: () -> Unit,
    mentionMode: String,
    onMentionModeChange: (String) -> Unit,
    brandAssetCount: Int,
    selectedGuildName: String,
    announceChannel: String,
    previewText: String,
    previewLinkUrl: String,
    onAddImages: () -> Unit,
    onAddVideos: () -> Unit,
    onSave: () -> Unit,
) {
    val brandAccentColor = Color.hsv(
        hue = brandAccentHue,
        saturation = brandAccentSaturation,
        value = brandAccentBrightness,
    )
    StepSectionCard(
        step = 1,
        title = "Server branding",
        subtitle = "",
    ) {
        OutlinedTextField(
            value = brandName,
            onValueChange = onBrandNameChange,
            label = { Text("Brand name") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        BrandingAssetRow(
            title = "Guild logo",
            localUri = brandLogoLocalUri,
            remoteUrl = brandLogoUrl,
            onPick = onPickBrandLogo,
            onClearLocal = onClearBrandLogo,
        )
        if (brandLogoUrl.isNotBlank() && brandLogoLocalUri.isBlank()) {
            Text(
                text = "Temporary remote URL in use for logo (picker upload preferred).",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        BrandingAssetRow(
            title = "Banner / embed art",
            localUri = brandPreviewLocalUri,
            remoteUrl = previewImageUrl,
            onPick = onPickBanner,
            onClearLocal = onClearBrandBanner,
        )
        if (previewImageUrl.isNotBlank() && brandPreviewLocalUri.isBlank()) {
            Text(
                text = "Temporary remote URL in use for banner (picker upload preferred).",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Text(
            text = "Mention mode",
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        val mentionChoices = listOf(
            "role" to "Role",
            "member" to "Creator",
            "both" to "Both",
        )
        val idx = mentionChoices.indexOfFirst { it.first == mentionMode }.coerceAtLeast(0)
        SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
            mentionChoices.forEachIndexed { index, entry ->
                SegmentedButton(
                    shape = SegmentedButtonDefaults.itemShape(index, mentionChoices.size),
                    selected = index == idx,
                    onClick = { onMentionModeChange(entry.first) },
                ) {
                    Text(entry.second)
                }
            }
        }
        val mentionPreviewHint = buildString {
            when (mentionMode) {
                "role" -> {
                    append("Preview: pings the ")
                    append(
                        brandRoleMention.trim().takeIf { it.isNotBlank() }
                            ?: "configured live-role mention",
                    )
                    append(".")
                }
                "member" -> append("Preview: includes the monitored creator/user mention.")
                else -> append("Preview: combines live-role and creator mentions when both IDs are configured.")
            }
        }
        Text(
            text = mentionPreviewHint,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        OutlinedTextField(
            value = brandEmbedTitle,
            onValueChange = onBrandEmbedTitleChange,
            label = { Text("Discord post title") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = brandCallToAction,
            onValueChange = onBrandCallToActionChange,
            label = { Text("Button label") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = brandRoleMention,
            onValueChange = onBrandRoleMentionChange,
            label = { Text("Role mention") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = brandFooter,
            onValueChange = onBrandFooterChange,
            label = { Text("Footer line") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        FilledTonalButton(onClick = onSave, modifier = Modifier.fillMaxWidth()) {
            Text("Save branding")
        }
    }
}

@Composable
private fun ConnectSocialsOverviewCard(connectionCount: Int) {
    SectionCard(
        title = "Socials",
        subtitle = "",
    ) {
        InfoLine("Connected accounts", connectionCount.toString())
    }
}

@Composable
private fun MemberRequestsOverviewCard(requestCount: Int) {
    SectionCard(
        title = "Creators",
        subtitle = "",
    ) {
        InfoLine("Saved entries", requestCount.toString())
    }
}

@Composable
private fun InfoLine(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = "$label:",
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            text = value,
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.weight(1f),
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}

private fun liveActivityHeadline(item: AutomationActivityItem): String {
    val eventTypeLower = item.eventType.lowercase(Locale.getDefault())
    val titleHintsLive = item.title.contains("went live", ignoreCase = true) ||
        item.title.contains("live detected", ignoreCase = true)
    val liveLike = eventTypeLower.contains("live") || titleHintsLive
    if (!liveLike) return item.title

    val hint = item.creatorHint.trim().ifBlank {
        Regex("""^[“\"']?(.+?)[”\"']?\s+(just\s+went\s+live|is\s+live)""", RegexOption.IGNORE_CASE)
            .find(item.title.trim())
            ?.groupValues
            ?.getOrNull(1)
            ?.trim()
            .orEmpty()
    }
    if (hint.isNotBlank() && !hint.equals("creator", ignoreCase = true)) {
        return "[$hint] just went live"
    }

    Regex("""^(.+?)\s+is\s+live\b""", RegexOption.IGNORE_CASE).find(item.body.trim())?.groupValues
        ?.getOrNull(1)?.trim()?.takeIf { it.isNotBlank() && !it.equals("creator", ignoreCase = true) }?.let { name ->
            return "[$name] just went live"
        }

    Regex("""^(.+?)\s+went\s+live""", RegexOption.IGNORE_CASE).find(item.body.trim())?.groupValues
        ?.getOrNull(1)?.trim()?.takeIf { it.isNotBlank() && !it.equals("creator", ignoreCase = true) }?.let { name ->
            return "[$name] just went live"
        }

    if (item.body.isNotBlank()) {
        val sentence = item.body.split(Regex("""(?<=[.!?])\s+""")).firstOrNull()?.trim().orEmpty()
        if (sentence.length in 3..96 &&
            !sentence.equals("creator just went live", ignoreCase = true) &&
            !sentence.equals("creator is live", ignoreCase = true)
        ) {
            return sentence.trimEnd('.', '!')
        }
    }

    return if (hint.isNotBlank()) "[$hint] just went live" else item.title
}

private fun automationEventFriendlyLabel(eventType: String): String {
    val t = eventType.lowercase(Locale.getDefault())
    return when {
        t.contains("live") -> "Live detected"
        t.contains("post.sent") -> "Post sent"
        t.contains("loop") -> "Loop guard"
        t.contains("error") -> "Issue"
        else -> eventType.replace('.', ' ').trim()
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AutomationHomeSection(
    home: JSONObject?,
    activity: List<AutomationActivityItem>,
    scheduledPosts: List<CreatorDispatchRecord>,
    token: String?,
    liveStatusSummary: String,
    backgroundMonitor: Boolean,
    fastMonitor: Boolean,
    onRefreshAutomation: () -> Unit,
    onRefreshLiveStatus: () -> Unit,
    onSyncLive: () -> Unit,
    onBackgroundMonitorChanged: (Boolean) -> Unit,
    onFastMonitorChanged: (Boolean) -> Unit,
    onPostNow: () -> Unit,
    onBoostLast: () -> Unit,
) {
    val summary = AutomationSummary.fromJson(home?.optJSONObject("summary"))
    SectionCard(
        title = "Stats",
        subtitle = "",
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                MetricTile("Live now", summary.creatorsLive.toString(), Modifier.weight(1f))
                MetricTile("Posts today", summary.postsToday.toString(), Modifier.weight(1f))
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                MetricTile(
                    label = "Success",
                    value = summary.successRate?.let { "$it%" } ?: "--",
                    modifier = Modifier.weight(1f),
                )
                MetricTile(
                    label = "Scheduled",
                    value = summary.scheduledCount.coerceAtLeast(0).toString(),
                    modifier = Modifier.weight(1f),
                )
            }
        }
        Surface(
            modifier = Modifier.fillMaxWidth(),
            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.75f),
            contentColor = MaterialTheme.colorScheme.onSurface,
            shape = RoundedCornerShape(14.dp),
        ) {
            Text(
                text = liveStatusSummary,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(12.dp),
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilledTonalButton(onClick = onRefreshAutomation, modifier = Modifier.weight(1f)) {
                Text("Refresh")
            }
            TextButton(onClick = onRefreshLiveStatus, enabled = token != null, modifier = Modifier.weight(1f)) {
                Text("Live check")
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(onClick = onPostNow, modifier = Modifier.weight(1f)) {
                Text("Post")
            }
            TextButton(onClick = onBoostLast, modifier = Modifier.weight(1f)) {
                Text("Boost")
            }
            TextButton(onClick = onSyncLive, enabled = token != null, modifier = Modifier.weight(1f)) {
                Text("Sync")
            }
        }
    }
    SectionCard(
        title = "Activity",
        subtitle = "",
    ) {
        if (activity.isEmpty()) {
            Text("No automation events yet.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                activity.take(5).forEach { item -> ActivityRow(item) }
            }
        }
    }

    SectionCard(title = "Scheduled", subtitle = "") {
        if (scheduledPosts.isEmpty()) {
            Text("No scheduled posts queued.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                scheduledPosts.take(5).forEach { post -> ScheduledPostRow(post = post) }
            }
        }
    }
}

@Composable
private fun MetricTile(label: String, value: String, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier,
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.72f),
        contentColor = MaterialTheme.colorScheme.onSurface,
        shape = RoundedCornerShape(14.dp),
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text(value, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

private fun compactActivityTime(raw: String): String {
    val trimmed = raw.trim()
    if (trimmed.isBlank()) return "Recent"
    return trimmed
        .replace('T', ' ')
        .removeSuffix("Z")
        .take(16)
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ActivityRow(item: AutomationActivityItem) {
    var detailOpen by remember(item.activityId) { mutableStateOf(false) }
    val headline = liveActivityHeadline(item)
    val bodyText = item.body.trim().takeUnless {
        it.equals("Creator is live on twitch.", ignoreCase = true) ||
            it.equals("Creator just went live", ignoreCase = true) ||
            it.equals(headline, ignoreCase = true)
    }.orEmpty()
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.66f),
        contentColor = MaterialTheme.colorScheme.onSurface,
        shape = RoundedCornerShape(18.dp),
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                val liveSuffix = " just went live"
                if (headline.endsWith(liveSuffix, ignoreCase = true)) {
                    val namePart = headline.dropLast(liveSuffix.length).trim()
                    Row(
                        modifier = Modifier.weight(1f),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = namePart.ifBlank { headline },
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                        if (namePart.isNotBlank()) {
                            Text(
                                text = liveSuffix,
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                            )
                        }
                    }
                } else {
                    Text(
                        text = headline,
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.weight(1f),
                    )
                }
                TextButton(onClick = { detailOpen = true }) { Text("Details") }
            }
            Text(
                text = automationEventFriendlyLabel(item.eventType),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (bodyText.isNotBlank()) {
                Text(
                    bodyText,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (item.platform.isNotBlank()) {
                    Text(
                        text = platformDisplayName(item.platform),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
                Text(
                    text = compactActivityTime(item.createdAt),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }

    if (detailOpen) {
        AlertDialog(
            onDismissRequest = { detailOpen = false },
            confirmButton = {
                TextButton(onClick = { detailOpen = false }) {
                    Text("Close")
                }
            },
            title = { Text(headline, style = MaterialTheme.typography.titleMedium) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(item.body, style = MaterialTheme.typography.bodyMedium)
                    Text(
                        "Platform: ${item.platform.ifBlank { "unknown" }}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        "When: ${item.createdAt.ifBlank { "recent" }}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        "Raw event: ${item.eventType}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            },
        )
    }
}

@Composable
private fun ProfileSection(
    token: String?,
    displayName: String,
    onDisplayNameChange: (String) -> Unit,
    twitch: String,
    onTwitchChange: (String) -> Unit,
    youtube: String,
    onYouTubeChange: (String) -> Unit,
    kick: String,
    onKickChange: (String) -> Unit,
    onSave: () -> Unit,
) {
    SectionCard(
        title = "Profile defaults",
        subtitle = "Keep your creator identity and channel links aligned before you automate posts.",
    ) {
        OutlinedTextField(
            value = displayName,
            onValueChange = onDisplayNameChange,
            label = { Text("Display name (optional)") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = twitch,
            onValueChange = onTwitchChange,
            label = { Text("Twitch URL") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = youtube,
            onValueChange = onYouTubeChange,
            label = { Text("YouTube channel URL") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = kick,
            onValueChange = onKickChange,
            label = { Text("Kick URL") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        FilledTonalButton(
            onClick = onSave,
            modifier = Modifier.fillMaxWidth(),
            enabled = token != null,
        ) {
            Text("Save profile")
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CreatorComposerSection(
    draftName: String,
    onDraftNameChange: (String) -> Unit,
    draftPostText: String,
    onDraftPostTextChange: (String) -> Unit,
    draftLinkUrl: String,
    onDraftLinkUrlChange: (String) -> Unit,
    draftTargets: MutableList<String>,
    draftIsDefault: Boolean,
    onDraftDefaultChange: () -> Unit,
    draftMediaItems: List<MediaLibraryItem>,
    onAddImages: () -> Unit,
    onAddVideos: () -> Unit,
    onClearAttached: () -> Unit,
    onRemoveDraftMedia: (String) -> Unit,
    editingTemplateLocalId: String?,
    onSaveTemplate: () -> Unit,
    onQueuePublish: () -> Unit,
    onResetDraft: () -> Unit,
) {
    SectionCard(
        title = "Post template builder",
        subtitle = "Build templates the same way as Quick post — copy, preview, queue, schedule.",
    ) {
        val targetsDiscord = draftTargets.any { it.equals("discord", ignoreCase = true) }
        val hasDiscordVideoConflict = targetsDiscord &&
            draftMediaItems.any { it.kind == MediaKind.VIDEO }
        if (editingTemplateLocalId != null) {
            Surface(
                color = MaterialTheme.colorScheme.primary.copy(alpha = 0.10f),
                contentColor = MaterialTheme.colorScheme.onSurface,
                shape = RoundedCornerShape(16.dp),
            ) {
                Text(
                    text = "Editing saved template",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                )
            }
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            FilledTonalButton(
                onClick = onAddImages,
                modifier = Modifier.weight(1f),
            ) {
                Text("Add image")
            }
            FilledTonalButton(
                onClick = onAddVideos,
                enabled = !targetsDiscord,
                modifier = Modifier.weight(1f),
            ) {
                Text("Add video")
            }
            TextButton(
                onClick = onClearAttached,
                enabled = draftMediaItems.isNotEmpty(),
                modifier = Modifier.weight(1f),
            ) {
                Text("Clear attached")
            }
        }
        if (targetsDiscord) {
            Text(
                text = "Video uploads are currently unsupported for Discord targets in mobile. Use images or a link.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (hasDiscordVideoConflict) {
            Text(
                text = "Remove Discord from targets or detach video before sending.",
                style = MaterialTheme.typography.bodySmall,
                color = Color(0xFFFFB4A9),
            )
        }
        OutlinedTextField(
            value = draftName,
            onValueChange = onDraftNameChange,
            label = { Text("Template name") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = draftPostText,
            onValueChange = onDraftPostTextChange,
            label = { Text("Post copy") },
            placeholder = {
                Text("e.g. \u201CNight stream live now — clip + link inside.\u201D")
            },
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = draftLinkUrl,
            onValueChange = onDraftLinkUrlChange,
            label = { Text("Primary link") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Text(
            text = "Target socials",
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            CreatorStudioPlatforms.forEach { platform ->
                val selected = platform in draftTargets
                FilterChip(
                    selected = selected,
                    onClick = {
                        if (!draftTargets.remove(platform)) {
                            draftTargets.add(platform)
                        }
                    },
                    colors = watchMeChipColors(),
                    label = { PlatformChipLabel(platform) },
                )
            }
        }
        FilterChip(
            selected = draftIsDefault,
            onClick = onDraftDefaultChange,
            colors = watchMeChipColors(),
            label = { Text("Use as default template") },
        )
        if (draftMediaItems.isNotEmpty()) {
            AttachedMediaCard(
                items = draftMediaItems,
                onRemove = onRemoveDraftMedia,
            )
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            FilledTonalButton(
                onClick = onSaveTemplate,
                modifier = Modifier.weight(1f),
            ) {
                Text("Save template")
            }
            Button(
                onClick = onQueuePublish,
                modifier = Modifier.weight(1f),
            ) {
                Text("Queue publish")
            }
        }
        TextButton(
            onClick = onResetDraft,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Reset draft")
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SchedulePlannerSection(
    scheduleDate: String,
    onScheduleDateChange: (String) -> Unit,
    scheduleTime: String,
    onScheduleTimeChange: (String) -> Unit,
    savedTemplates: List<CreatorPostTemplate>,
    selectedTemplateLocalId: String?,
    onSelectedTemplateLocalIdChange: (String) -> Unit,
    scheduleDraftName: String,
    onScheduleDraftNameChange: (String) -> Unit,
    scheduleDraftPostText: String,
    onScheduleDraftPostTextChange: (String) -> Unit,
    scheduleDraftLinkUrl: String,
    onScheduleDraftLinkUrlChange: (String) -> Unit,
    dispatchHistory: List<CreatorDispatchRecord>,
    onSchedulePost: () -> Unit,
) {
    val selectedDate = parseIsoDateOrToday(scheduleDate)
    val weekDates = remember(selectedDate) { (-3..3).map { selectedDate.plusDays(it.toLong()) } }
    val scheduledPosts = remember(dispatchHistory) {
        dispatchHistory.filter { it.status == "scheduled_local" }
    }
    val scheduledByDate = remember(scheduledPosts) {
        scheduledPosts.groupBy { formatIsoDate(it.createdAtEpochMs) }
    }
    val selectedDayPosts = remember(scheduledByDate, selectedDate) {
        scheduledByDate[formatIsoDate(selectedDate)]?.sortedBy { it.createdAtEpochMs }.orEmpty()
    }
    SectionCard(
        title = "Scheduled posts",
        subtitle = "Pick a saved template, choose a date and time, then queue it for server-side dispatch.",
    ) {
        Text(
            text = "Pick a date",
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            weekDates.forEach { day ->
                val dateKey = formatIsoDate(day)
                DatePlannerChip(
                    label = dayOfWeekLabel(day),
                    sublabel = monthDayLabel(day),
                    selected = dateKey == formatIsoDate(selectedDate),
                    savedCount = scheduledByDate[dateKey]?.size ?: 0,
                    onClick = { onScheduleDateChange(dateKey) },
                )
            }
        }
        Text(
            text = "Saved templates",
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (savedTemplates.isNotEmpty()) {
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                savedTemplates.forEach { template ->
                    FilterChip(
                        selected = selectedTemplateLocalId == template.localId,
                        onClick = { onSelectedTemplateLocalIdChange(template.localId) },
                        colors = watchMeChipColors(),
                        label = { Text(template.name) },
                    )
                }
            }
        } else {
            Text(
                text = "Save a template first.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        OutlinedTextField(
            value = scheduleTime,
            onValueChange = onScheduleTimeChange,
            label = { Text("Time") },
            placeholder = { Text("19:30") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = scheduleDraftName,
            onValueChange = onScheduleDraftNameChange,
            label = { Text("Post name") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = scheduleDraftPostText,
            onValueChange = onScheduleDraftPostTextChange,
            label = { Text("Post copy") },
            minLines = 5,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = scheduleDraftLinkUrl,
            onValueChange = onScheduleDraftLinkUrlChange,
            label = { Text("Link") },
            placeholder = { Text("https://") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        FilledTonalButton(
            onClick = onSchedulePost,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Icon(
                imageVector = Icons.Rounded.Schedule,
                contentDescription = "Schedule",
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text("Save post on this day")
        }
        if (selectedDayPosts.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                selectedDayPosts.forEach { post -> ScheduledPostRow(post = post) }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SocialPreviewSection(
    displayName: String,
    selectedGuildName: String,
    announceChannel: String,
    draftPostText: String,
    draftLinkUrl: String,
    draftTargets: List<String>,
    brandName: String,
    brandEmbedTitle: String,
    brandCallToAction: String,
    brandRoleMention: String,
    brandFooter: String,
    brandAccentColor: Color,
    draftBannerUri: String = "",
    draftVideoUri: String = "",
) {
    SectionCard(
        title = "Post preview",
        subtitle = "Preview how the current template will read before it is saved or queued.",
    ) {
        DiscordPostPreviewCard(
            guildName = selectedGuildName,
            announceChannel = announceChannel,
            authorName = brandName.ifBlank { displayName.ifBlank { "WatchMe Pro" } },
            embedTitle = brandEmbedTitle,
            roleMention = brandRoleMention,
            bodyText = draftPostText,
            linkUrl = draftLinkUrl,
            ctaLabel = brandCallToAction,
            footer = brandFooter,
            accentColor = brandAccentColor,
            avatarImageModel = "",
            embedPreviewImageUrl = draftBannerUri,
            discordAttachmentVideoUri = draftVideoUri,
        )
        val previewTargets = if (draftTargets.isNotEmpty()) draftTargets else listOf("discord")
        Text(
            text = "Social templates",
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            previewTargets.forEach { platform ->
                PlatformPreviewCard(
                    platform = platform,
                    headline = draftPostText,
                    linkUrl = draftLinkUrl,
                    brandName = brandName.ifBlank { "WatchMe Pro" },
                    ctaLabel = brandCallToAction,
                )
            }
        }
        if (draftTargets.isNotEmpty()) {
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                draftTargets.forEach { platform ->
                    FilterChip(
                        selected = true,
                        onClick = {},
                        colors = watchMeChipColors(),
                        label = { PlatformChipLabel(platform) },
                    )
                }
            }
        }
    }
}

@Composable
private fun DatePlannerChip(
    label: String,
    sublabel: String,
    selected: Boolean,
    savedCount: Int,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        color = if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.18f) else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.78f),
        contentColor = MaterialTheme.colorScheme.onSurface,
        shape = RoundedCornerShape(18.dp),
        border = BorderStroke(
            width = if (selected) 2.dp else 1.dp,
            color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surface,
        ),
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(label, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurface)
            Text(sublabel, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (savedCount > 0) {
                Text(
                    text = "$savedCount saved",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
        }
    }
}

@Composable
private fun ScheduledPostsSummary(
    selectedDate: LocalDate,
    posts: List<CreatorDispatchRecord>,
) {
    SectionCard(
        title = "${dayOfWeekLabel(selectedDate)} schedule",
        subtitle = "",
    ) {
        InfoLine("Date", prettyDateLabel(selectedDate))
        InfoLine("Saved posts", posts.size.toString())
        if (posts.isEmpty()) {
            Text(
                text = "No saved post creations on this day yet.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                posts.forEach { post ->
                    ScheduledPostRow(post = post)
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ScheduledPostRow(post: CreatorDispatchRecord) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.72f),
        contentColor = MaterialTheme.colorScheme.onSurface,
        shape = RoundedCornerShape(18.dp),
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = post.templateName,
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Text(
                    text = timeOnlyLabel(post.createdAtEpochMs),
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
            if (post.postText.isNotBlank()) {
                Text(
                    text = post.postText,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (post.targetPlatforms.isNotEmpty()) {
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    post.targetPlatforms.forEach { platform ->
                        FilterChip(
                            selected = true,
                            onClick = {},
                            label = { PlatformChipLabel(platform) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun TemplatesQueueSection(
    savedTemplates: List<CreatorPostTemplate>,
    recentDispatches: List<CreatorDispatchRecord>,
    onLoadTemplate: (CreatorPostTemplate) -> Unit,
    onDeleteTemplate: (CreatorPostTemplate) -> Unit,
    onReuseDispatch: (CreatorDispatchRecord) -> Unit,
) {
    SectionCard(
        title = "Templates",
        subtitle = "",
    ) {
        if (savedTemplates.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                savedTemplates.forEach { template ->
                    TemplateSummaryCard(
                        template = template,
                        mediaCount = template.mediaUris.size,
                        onLoad = { onLoadTemplate(template) },
                        onDelete = { onDeleteTemplate(template) },
                    )
                }
            }
        } else {
            EmptyLibraryCard(
                title = "No templates saved yet",
                body = "Save your first quick post here, then reuse it whenever you need to move fast.",
            )
        }
        if (recentDispatches.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                recentDispatches.forEach { dispatch ->
                    DispatchSummaryCard(
                        dispatch = dispatch,
                        onReuse = { onReuseDispatch(dispatch) },
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun MediaLibrarySection(
    activeLibraryTab: LibraryTab,
    onLibraryTabChange: (LibraryTab) -> Unit,
    imageItems: List<MediaLibraryItem>,
    videoItems: List<MediaLibraryItem>,
    imageLibraryUris: List<String>,
    videoLibraryUris: List<String>,
    selectedImages: MutableList<String>,
    selectedVideos: MutableList<String>,
    onAddImages: () -> Unit,
    onAddVideos: () -> Unit,
    onOpenImage: (MediaLibraryItem) -> Unit,
    onOpenVideo: (MediaLibraryItem) -> Unit,
    onRemoveImage: (String) -> Unit,
    onRemoveVideo: (String) -> Unit,
    onBulkRemoveImages: () -> Unit,
    onBulkRemoveVideos: () -> Unit,
) {
    SectionCard(
        title = "Media",
        subtitle = "",
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            FilledTonalButton(
                onClick = onAddImages,
                modifier = Modifier.weight(1f),
            ) {
                Text("Add images")
            }
            FilledTonalButton(
                onClick = onAddVideos,
                modifier = Modifier.weight(1f),
            ) {
                Text("Add videos")
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            FilterChip(
                selected = activeLibraryTab == LibraryTab.IMAGES,
                onClick = { onLibraryTabChange(LibraryTab.IMAGES) },
                label = { Text("Images (${imageItems.size})") },
            )
            FilterChip(
                selected = activeLibraryTab == LibraryTab.VIDEOS,
                onClick = { onLibraryTabChange(LibraryTab.VIDEOS) },
                label = { Text("Videos (${videoItems.size})") },
            )
        }
        if (activeLibraryTab == LibraryTab.IMAGES && imageItems.isNotEmpty()) {
            SelectionToolbar(
                selectedCount = selectedImages.size,
                onSelectAll = {
                    selectedImages.clear()
                    selectedImages.addAll(imageLibraryUris)
                },
                onRemoveSelected = onBulkRemoveImages,
            )
            ImageLibraryGrid(
                items = imageItems,
                selectedUris = selectedImages.toSet(),
                onToggleSelected = { uriString -> toggleSelection(selectedImages, uriString) },
                onPreview = onOpenImage,
                onRemove = onRemoveImage,
            )
        } else if (activeLibraryTab == LibraryTab.VIDEOS && videoItems.isNotEmpty()) {
            SelectionToolbar(
                selectedCount = selectedVideos.size,
                onSelectAll = {
                    selectedVideos.clear()
                    selectedVideos.addAll(videoLibraryUris)
                },
                onRemoveSelected = onBulkRemoveVideos,
            )
            VideoLibraryList(
                items = videoItems,
                selectedUris = selectedVideos.toSet(),
                onToggleSelected = { uriString -> toggleSelection(selectedVideos, uriString) },
                onPreview = onOpenVideo,
                onRemove = onRemoveVideo,
            )
        } else {
            EmptyLibraryCard(
                title = if (activeLibraryTab == LibraryTab.IMAGES) {
                    "No images in your library yet"
                } else {
                    "No videos in your library yet"
                },
                body = if (activeLibraryTab == LibraryTab.IMAGES) {
                    "Bring in posters, thumbnails, or creator shots so WatchMe is ready from your phone."
                } else {
                    "Bring in clips, trailers, or short updates for fast mobile selection."
                },
            )
        }
    }
}

@Composable
private fun SocialConnectionsSection(
    savedConnections: List<CreatorSocialConnection>,
    pendingPlatform: String,
    onConnect: (String) -> Unit,
    onDisconnect: (String) -> Unit,
    onSelectPage: (String, String) -> Unit,
) {
    SectionCard(
        title = "Connect to your socials",
        subtitle = "",
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            CreatorStudioPlatforms.forEach { platform ->
                val connection = savedConnections.firstOrNull { it.platform == platform }
                SocialConnectionRow(
                    platform = platform,
                    oauthPending = pendingPlatform.equals(platform, ignoreCase = true),
                    connected = connection != null,
                    accountName = connection?.externalAccountName.orEmpty(),
                    avatarUrl = connection?.avatarUrl.orEmpty(),
                    status = connection?.status.orEmpty(),
                    pageOptions = connection?.pageOptions.orEmpty(),
                    onConnect = { onConnect(platform) },
                    onDisconnect = { onDisconnect(platform) },
                    onSelectPage = { pageId -> onSelectPage(platform, pageId) },
                )
            }
        }
    }
}

@Composable
private fun SocialConnectionRow(
    platform: String,
    oauthPending: Boolean,
    connected: Boolean,
    accountName: String,
    avatarUrl: String,
    status: String,
    pageOptions: List<SocialPageOption>,
    onConnect: () -> Unit,
    onDisconnect: () -> Unit,
    onSelectPage: (String) -> Unit,
) {
    val context = LocalContext.current
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.78f),
        contentColor = MaterialTheme.colorScheme.onSurface,
        shape = RoundedCornerShape(20.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                val model = avatarUrl.trim().takeIf {
                    connected && it.startsWith("http", ignoreCase = true)
                }
                if (model != null) {
                    AsyncImage(
                        model = ImageRequest.Builder(context).data(model).crossfade(true).build(),
                        contentDescription = null,
                        modifier = Modifier
                            .size(44.dp)
                            .clip(CircleShape),
                        contentScale = ContentScale.Crop,
                    )
                } else {
                    PlatformLogoImage(platform = platform, contentDescription = "${platformDisplayName(platform)} logo")
                }
                Column(modifier = Modifier.weight(1f)) {
                    Text(platformDisplayName(platform), style = MaterialTheme.typography.titleSmall)
                    Text(
                        text = when {
                            oauthPending -> "Connecting…"
                            status.equals("pending_selection", ignoreCase = true) -> "Choose a Page to finish"
                            status.equals("error", ignoreCase = true) ||
                                status.equals("revoked", ignoreCase = true) -> "Needs reconnect"
                            connected -> accountName.ifBlank { "Connected" }
                            else -> "Not connected"
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = when {
                            oauthPending -> MaterialTheme.colorScheme.secondary
                            status.equals("error", ignoreCase = true) -> Color(0xFFFFB4A9)
                            else -> MaterialTheme.colorScheme.onSurfaceVariant
                        },
                    )
                }
                if (connected) {
                    TextButton(onClick = onDisconnect) {
                        Text("Disconnect")
                    }
                } else {
                    FilledTonalButton(
                        onClick = onConnect,
                        enabled = !oauthPending,
                    ) {
                        Text("Connect")
                    }
                }
            }
            if (status == "pending_selection" && pageOptions.isNotEmpty()) {
                pageOptions.forEach { option ->
                    FilledTonalButton(
                        modifier = Modifier.fillMaxWidth(),
                        onClick = { onSelectPage(option.id) },
                    ) {
                        val label = if (option.instagramAccountName.isNotBlank()) {
                            "${option.name} / ${option.instagramAccountName}"
                        } else {
                            option.name
                        }
                        Text(label, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
            if (connected && status.isNotBlank() && !status.equals("active", ignoreCase = true)) {
                Text(
                    text = "Status: ${status.replace('_', ' ')}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun DiscordPostPreviewCard(
    guildName: String,
    announceChannel: String,
    authorName: String,
    embedTitle: String,
    roleMention: String,
    bodyText: String,
    linkUrl: String,
    ctaLabel: String,
    footer: String,
    accentColor: Color,
    avatarImageModel: String = "",
    embedPreviewImageUrl: String = "",
    discordAttachmentVideoUri: String = "",
) {
    val context = LocalContext.current
    Surface(
        color = Color(0xFF111214),
        shape = RoundedCornerShape(20.dp),
        border = BorderStroke(1.dp, Color(0xFF1E2228)),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(
                verticalAlignment = Alignment.Top,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Surface(
                    modifier = Modifier.size(36.dp),
                    shape = CircleShape,
                    color = accentColor.copy(alpha = 0.18f),
                ) {
                    val avatar = avatarImageModel.trim()
                    if (avatar.startsWith("content:") || avatar.startsWith("file:") || avatar.startsWith("http", ignoreCase = true)) {
                        AsyncImage(
                            model = ImageRequest.Builder(context).data(avatar).crossfade(true).build(),
                            contentDescription = "Brand artwork",
                            modifier = Modifier
                                .size(36.dp)
                                .clip(CircleShape),
                            contentScale = ContentScale.Crop,
                        )
                    } else {
                        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            Text(
                                text = "W",
                                color = Color.White,
                                fontWeight = FontWeight.Bold,
                            )
                        }
                    }
                }
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = authorName.ifBlank { "WatchMe Pro" },
                            style = MaterialTheme.typography.titleSmall,
                            color = Color(0xFFEFF3FA),
                            fontWeight = FontWeight.Bold,
                        )
                        Text(
                            text = announceChannel.ifBlank { "#live-alerts" },
                            style = MaterialTheme.typography.bodySmall,
                            color = Color(0xFF7C9CFF),
                        )
                        Text(
                            text = "now",
                            style = MaterialTheme.typography.bodySmall,
                            color = Color(0xFF8E9297),
                        )
                    }
                    Text(
                        text = guildName.ifBlank { "WatchMe Pro HQ" },
                        style = MaterialTheme.typography.bodySmall,
                        color = Color(0xFF8E9297),
                    )
                    Surface(
                        shape = RoundedCornerShape(16.dp),
                        color = Color(0xFF2B2D31),
                    ) {
                        Row(
                            modifier = Modifier.padding(12.dp),
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Box(
                                modifier = Modifier
                                    .width(4.dp)
                                    .height(134.dp)
                                    .clip(RoundedCornerShape(999.dp))
                                    .background(accentColor),
                            )
                            Column(
                                modifier = Modifier.weight(1f),
                                verticalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                if (roleMention.isNotBlank()) {
                                    Text(
                                        text = roleMention,
                                        style = MaterialTheme.typography.labelLarge,
                                        color = accentColor,
                                    )
                                }
                                Text(
                                    text = embedTitle.ifBlank { "WatchMe Pro Alert" },
                                    style = MaterialTheme.typography.titleMedium,
                                    color = Color.White,
                                    fontWeight = FontWeight.Bold,
                                )
                                Text(
                                    text = bodyText.ifBlank { "Your Discord post preview will show here." },
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = Color(0xFFDBDEE1),
                                )
                                if (linkUrl.isNotBlank()) {
                                    Text(
                                        text = linkUrl,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = Color(0xFF00A8FC),
                                    )
                                }
                                val headerImage = embedPreviewImageUrl.trim()
                                if (headerImage.startsWith("content:", ignoreCase = true) ||
                                    headerImage.startsWith("http", ignoreCase = true)
                                ) {
                                    AsyncImage(
                                        model = ImageRequest.Builder(context).data(headerImage).crossfade(true).build(),
                                        contentDescription = "Embed banner",
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .height(150.dp)
                                            .clip(RoundedCornerShape(12.dp)),
                                        contentScale = ContentScale.Crop,
                                    )
                                }
                                val discordVideo = discordAttachmentVideoUri.trim()
                                if (discordVideo.startsWith("content:", ignoreCase = true) ||
                                    discordVideo.startsWith("file:", ignoreCase = true)
                                ) {
                                    Surface(
                                        modifier = Modifier
                                            .fillMaxWidth(),
                                        shape = RoundedCornerShape(12.dp),
                                        color = Color(0xFF050608),
                                        border = BorderStroke(1.dp, Color(0xFF2F3136)),
                                    ) {
                                        Row(
                                            modifier = Modifier.padding(12.dp),
                                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                                            verticalAlignment = Alignment.CenterVertically,
                                        ) {
                                            Surface(
                                                color = Color(0xFF5865F2).copy(alpha = 0.2f),
                                                shape = RoundedCornerShape(12.dp),
                                            ) {
                                                Icon(
                                                    imageVector = Icons.Rounded.Videocam,
                                                    contentDescription = "Video attachment",
                                                    tint = Color(0xFF7C9CFF),
                                                    modifier = Modifier.padding(14.dp),
                                                )
                                            }
                                            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                                Text(
                                                    text = "Video",
                                                    style = MaterialTheme.typography.titleSmall,
                                                    color = Color.White,
                                                    fontWeight = FontWeight.Bold,
                                                )
                                            }
                                        }
                                    }
                                }
                                Row(
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Surface(
                                        color = Color(0xFF5865F2),
                                        shape = RoundedCornerShape(10.dp),
                                    ) {
                                        Text(
                                            text = ctaLabel.ifBlank { "Open link" },
                                            style = MaterialTheme.typography.labelLarge,
                                            color = Color.White,
                                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                                        )
                                    }
                                    Text(
                                        text = footer.ifBlank { "Others notify, we automate." },
                                        style = MaterialTheme.typography.bodySmall,
                                        color = Color(0xFF8E9297),
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PlatformPreviewCard(
    platform: String,
    headline: String,
    linkUrl: String,
    brandName: String,
    ctaLabel: String,
) {
    when (platform.trim().lowercase(Locale.getDefault())) {
        "discord" -> return
        "x", "twitter" -> XPreviewCard(headline, linkUrl, brandName)
        "instagram", "ig" -> InstagramPreviewCard(headline, linkUrl, brandName)
        "facebook", "fb" -> FacebookPreviewCard(headline, linkUrl, brandName)
        "youtube", "yt" -> YouTubePreviewCard(headline, linkUrl, brandName)
        "twitch" -> TwitchPreviewCard(headline, linkUrl, brandName)
        "kick" -> KickPreviewCard(headline, linkUrl, brandName)
        else -> GenericSocialPreviewCard(platform, headline, linkUrl, brandName, ctaLabel)
    }
}

@Composable
private fun XPreviewCard(headline: String, linkUrl: String, brandName: String) {
    SocialShellCard("x", brandName, "Post") {
        Text(previewCopyForPlatform("x", headline), color = MaterialTheme.colorScheme.onSurface)
        if (linkUrl.isNotBlank()) Text(linkUrl, color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun InstagramPreviewCard(headline: String, linkUrl: String, brandName: String) {
    SocialShellCard("instagram", brandName, "Caption") {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .height(160.dp),
            shape = RoundedCornerShape(16.dp),
            color = Color(0xFF2A2234),
        ) {}
        Text(previewCopyForPlatform("instagram", headline), color = MaterialTheme.colorScheme.onSurface)
        if (linkUrl.isNotBlank()) Text("Link in bio: $linkUrl", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun FacebookPreviewCard(headline: String, linkUrl: String, brandName: String) {
    SocialShellCard("facebook", brandName, "Page post") {
        Text(previewCopyForPlatform("facebook", headline), color = MaterialTheme.colorScheme.onSurface)
        if (linkUrl.isNotBlank()) {
            Surface(
                color = MaterialTheme.colorScheme.surface.copy(alpha = 0.9f),
                shape = RoundedCornerShape(14.dp),
            ) {
                Column(modifier = Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(brandName, style = MaterialTheme.typography.labelLarge)
                    Text(linkUrl, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
                }
            }
        }
    }
}

@Composable
private fun YouTubePreviewCard(headline: String, linkUrl: String, brandName: String) {
    SocialShellCard("youtube", brandName, "Community post") {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .height(120.dp),
            shape = RoundedCornerShape(16.dp),
            color = Color(0xFF301818),
        ) {}
        Text(previewCopyForPlatform("youtube", headline), color = MaterialTheme.colorScheme.onSurface)
        if (linkUrl.isNotBlank()) Text(linkUrl, color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun TwitchPreviewCard(headline: String, linkUrl: String, brandName: String) {
    SocialShellCard("twitch", brandName, "Stream alert") {
        Text(previewCopyForPlatform("twitch", headline), color = MaterialTheme.colorScheme.onSurface)
        if (linkUrl.isNotBlank()) Text(linkUrl, color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun KickPreviewCard(headline: String, linkUrl: String, brandName: String) {
    SocialShellCard("kick", brandName, "Channel update") {
        Text(previewCopyForPlatform("kick", headline), color = MaterialTheme.colorScheme.onSurface)
        if (linkUrl.isNotBlank()) Text(linkUrl, color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun GenericSocialPreviewCard(
    platform: String,
    headline: String,
    linkUrl: String,
    brandName: String,
    ctaLabel: String,
) {
    SocialShellCard(platform, brandName, ctaLabel.ifBlank { "Preview" }) {
        Text(previewCopyForPlatform(platform, headline), color = MaterialTheme.colorScheme.onSurface)
        if (linkUrl.isNotBlank()) Text(linkUrl, color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun SocialShellCard(
    platform: String,
    brandName: String,
    subtitle: String,
    content: @Composable () -> Unit,
) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f),
        shape = RoundedCornerShape(20.dp),
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                PlatformLogoImage(
                    platform = platform,
                    compact = true,
                    contentDescription = "${platformDisplayName(platform)} preview",
                )
                Column {
                    Text(
                        text = platformDisplayName(platform),
                        style = MaterialTheme.typography.titleSmall,
                    )
                    Text(
                        text = "$brandName • $subtitle",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            content()
        }
    }
}

@Composable
private fun ColorPickerSection(
    color: Color,
    hue: Float,
    onHueChange: (Float) -> Unit,
    saturation: Float,
    onSaturationChange: (Float) -> Unit,
    brightness: Float,
    onBrightnessChange: (Float) -> Unit,
) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.78f),
        shape = RoundedCornerShape(22.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.surface),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Surface(
                modifier = Modifier.size(46.dp),
                shape = RoundedCornerShape(14.dp),
                color = color,
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.onSurface.copy(alpha = 0.22f)),
            ) {}
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Preview", style = MaterialTheme.typography.labelLarge)
                Text("Hue", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Slider(value = hue, onValueChange = onHueChange, valueRange = 0f..360f)
                Text("Glow", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Slider(value = saturation, onValueChange = onSaturationChange, valueRange = 0.2f..1f)
                Text("Depth", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Slider(value = brightness, onValueChange = onBrightnessChange, valueRange = 0.35f..1f)
            }
        }
    }
}

@Composable
private fun GuildMemberDropdown(
    roster: List<GuildMemberPick>,
    selectedDiscordUserId: String,
    onPickMember: (GuildMemberPick) -> Unit,
    onClearPick: () -> Unit,
    title: String = "Discord member",
    fieldLabel: String = "Creator",
    emptyText: String = "Member list unavailable. Refresh after Discord login or check the selected server.",
) {
    val context = LocalContext.current
    Column(modifier = Modifier.fillMaxWidth()) {
        Text(
            text = title,
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(modifier = Modifier.height(4.dp))
        if (roster.isEmpty()) {
            Surface(
                modifier = Modifier.fillMaxWidth(),
                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.62f),
                contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
                shape = RoundedCornerShape(14.dp),
            ) {
                Text(
                    text = emptyText,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(12.dp),
                )
            }
            return
        }
        var expanded by remember { mutableStateOf(false) }
        val picked = roster.firstOrNull { it.discordUserId == selectedDiscordUserId }
        val summary = when {
            selectedDiscordUserId.isBlank() -> "Choose from server members"
            picked != null -> picked.displayName.ifBlank { picked.discordUserId }
            else -> "Saved member (${selectedDiscordUserId.take(8)})"
        }
        Box(modifier = Modifier.fillMaxWidth()) {
            OutlinedTextField(
                value = summary,
                onValueChange = {},
                readOnly = true,
                label = { Text(fieldLabel) },
                trailingIcon = {
                    Row {
                        if (selectedDiscordUserId.isNotBlank()) {
                            TextButton(onClick = onClearPick) {
                                Text("Clear")
                            }
                        }
                        TextButton(onClick = { expanded = true }) {
                            Text("Choose")
                        }
                    }
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { expanded = true },
            )
            DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                roster.forEach { member ->
                    val label = member.displayName.ifBlank { member.discordUserId }
                        .ifBlank { "Unknown member" }
                    DropdownMenuItem(
                        text = {
                            Text(
                                label,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                        },
                        leadingIcon = {
                            val avatar = member.avatarUrl.trim()
                            if (avatar.startsWith("http", ignoreCase = true)) {
                                AsyncImage(
                                    model = ImageRequest.Builder(context).data(avatar).crossfade(true).build(),
                                    contentDescription = null,
                                    modifier = Modifier
                                        .size(32.dp)
                                        .clip(CircleShape),
                                    contentScale = ContentScale.Crop,
                                )
                            } else {
                                Spacer(modifier = Modifier.size(32.dp))
                            }
                        },
                        onClick = {
                            onPickMember(member)
                            expanded = false
                        },
                    )
                }
            }
        }
    }
}
@Composable
private fun CreatorRosterSection(
    guildCreatorRoster: List<GuildMemberPick>,
    selectedRosterDiscordId: String,
    onPickGuildMember: (GuildMemberPick) -> Unit,
    onClearGuildMemberPick: () -> Unit,
    manualDiscordUserId: String,
    onManualDiscordUserIdChange: (String) -> Unit,
    pingTargetMode: String,
    onPingTargetModeChange: (String) -> Unit,
    memberName: String,
    onMemberNameChange: (String) -> Unit,
    displayNickname: String,
    onDisplayNicknameChange: (String) -> Unit,
    pingRoleId: String,
    onPingRoleIdChange: (String) -> Unit,
    pingMemberId: String,
    onPingMemberIdChange: (String) -> Unit,
    twitchUrl: String,
    onTwitchUrlChange: (String) -> Unit,
    youtubeUrl: String,
    onYoutubeUrlChange: (String) -> Unit,
    kickUrl: String,
    onKickUrlChange: (String) -> Unit,
    memberNotes: String,
    onMemberNotesChange: (String) -> Unit,
    memberRequests: List<MemberRequestItem>,
    editingMemberRequestId: String?,
    onSaveLinked: () -> Unit,
    onSavePending: () -> Unit,
    onEditRequest: (MemberRequestItem) -> Unit,
    onApproveRequest: (MemberRequestItem) -> Unit,
    onMoveToPending: (MemberRequestItem) -> Unit,
    onRemoveRequest: (MemberRequestItem) -> Unit,
    onClearDraft: () -> Unit,
) {
    var showManualDiscordEntry by remember { mutableStateOf(false) }
    val creatorRequests = remember(memberRequests) {
        memberRequests.filter { it.requestType.equals("creator", ignoreCase = true) }
    }
    val linkedMembers = remember(creatorRequests) {
        creatorRequests.filterNot { it.status.equals("pending_approval", ignoreCase = true) }
    }
    val pendingMembers = remember(creatorRequests) {
        creatorRequests.filter { it.status.equals("pending_approval", ignoreCase = true) }
    }
    SectionCard(
        title = "Creators",
        subtitle = "",
    ) {
        GuildMemberDropdown(
            roster = guildCreatorRoster,
            selectedDiscordUserId = selectedRosterDiscordId,
            onPickMember = onPickGuildMember,
            onClearPick = onClearGuildMemberPick,
            title = "Creator member",
            fieldLabel = "Choose creator",
        )
        if (guildCreatorRoster.isEmpty()) {
            TextButton(
                onClick = { showManualDiscordEntry = !showManualDiscordEntry },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(if (showManualDiscordEntry) "Hide advanced ID entry" else "Advanced: add creator outside member list")
            }
        }
        if (showManualDiscordEntry) {
            OutlinedTextField(
                value = manualDiscordUserId,
                onValueChange = {
                    onManualDiscordUserIdChange(it.trim())
                },
                label = { Text("Discord user ID") },
                placeholder = { Text("Only use if the creator is not in the server") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        OutlinedTextField(
            value = memberName,
            onValueChange = onMemberNameChange,
            label = { Text("Display name shown in WatchMe") },
            placeholder = { Text("Member name from server roster") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = displayNickname,
            onValueChange = onDisplayNicknameChange,
            label = { Text("Public / alert nickname") },
            placeholder = { Text("Optional: name shown in live alerts") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        val pingOptions = listOf(
            "role" to "Role",
            "member" to "Member",
            "both" to "Both",
        )
        val selectedPingIndex = pingOptions.indexOfFirst { it.first == pingTargetMode }.coerceAtLeast(0)
        SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
            pingOptions.forEachIndexed { index, entry ->
                SegmentedButton(
                    shape = SegmentedButtonDefaults.itemShape(
                        index = index,
                        count = pingOptions.size,
                    ),
                    onClick = { onPingTargetModeChange(entry.first) },
                    selected = index == selectedPingIndex,
                ) {
                    Text(entry.second)
                }
            }
        }
        val showRolePing = pingTargetMode == "role" || pingTargetMode == "both"
        val showMemberPing = pingTargetMode == "member" || pingTargetMode == "both"
        if (showRolePing) {
            OutlinedTextField(
                value = pingRoleId,
                onValueChange = onPingRoleIdChange,
                label = { Text("Ping Discord role ID (optional)") },
                placeholder = { Text("<@&1234567890> snowflake optional") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        if (showMemberPing) {
            GuildMemberDropdown(
                roster = guildCreatorRoster,
                selectedDiscordUserId = pingMemberId,
                onPickMember = { pick -> onPingMemberIdChange(pick.discordUserId) },
                onClearPick = { onPingMemberIdChange("") },
                title = "Ping member",
                fieldLabel = "Choose ping target",
                emptyText = "Member list unavailable. The creator mention will still work when a creator is selected.",
            )
        }
        OutlinedTextField(
            value = twitchUrl,
            onValueChange = onTwitchUrlChange,
            label = { Text("Twitch URL") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = youtubeUrl,
            onValueChange = onYoutubeUrlChange,
            label = { Text("YouTube URL") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = kickUrl,
            onValueChange = onKickUrlChange,
            label = { Text("Kick URL") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = memberNotes,
            onValueChange = onMemberNotesChange,
            label = { Text("Internal notes") },
            modifier = Modifier.fillMaxWidth(),
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            FilledTonalButton(onClick = onSaveLinked, modifier = Modifier.weight(1f)) {
                Text(if (editingMemberRequestId == null) "Link member" else "Save linked")
            }
            FilledTonalButton(onClick = onSavePending, modifier = Modifier.weight(1f)) {
                Text(if (editingMemberRequestId == null) "Save pending" else "Save pending")
            }
        }
        TextButton(
            onClick = onClearDraft,
            enabled = editingMemberRequestId != null || memberName.isNotBlank() ||
                displayNickname.isNotBlank() ||
                twitchUrl.isNotBlank() || youtubeUrl.isNotBlank() || kickUrl.isNotBlank() ||
                pingRoleId.isNotBlank() || pingMemberId.isNotBlank() ||
                selectedRosterDiscordId.isNotBlank() || manualDiscordUserId.isNotBlank() ||
                memberNotes.isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Clear")
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.surfaceVariant)
        RosterGroupSection(
            title = "Linked members",
            requests = linkedMembers,
            emptyText = "No linked members yet.",
            onEditRequest = onEditRequest,
            onApproveRequest = onApproveRequest,
            onMoveToPending = onMoveToPending,
            onRemoveRequest = onRemoveRequest,
        )
        RosterGroupSection(
            title = "Pending approval",
            requests = pendingMembers,
            emptyText = "No pending approvals.",
            onEditRequest = onEditRequest,
            onApproveRequest = onApproveRequest,
            onMoveToPending = onMoveToPending,
            onRemoveRequest = onRemoveRequest,
        )
    }
}

@Composable
private fun RosterGroupSection(
    title: String,
    requests: List<MemberRequestItem>,
    emptyText: String,
    onEditRequest: (MemberRequestItem) -> Unit,
    onApproveRequest: (MemberRequestItem) -> Unit,
    onMoveToPending: (MemberRequestItem) -> Unit,
    onRemoveRequest: (MemberRequestItem) -> Unit,
) {
    Text(
        text = title,
        style = MaterialTheme.typography.titleMedium,
        color = MaterialTheme.colorScheme.onSurface,
    )
    if (requests.isEmpty()) {
        Text(
            text = emptyText,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    } else {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            requests.forEach { request ->
                CreatorRosterCard(
                    request = request,
                    onEdit = { onEditRequest(request) },
                    onApprove = { onApproveRequest(request) },
                    onMoveToPending = { onMoveToPending(request) },
                    onRemove = { onRemoveRequest(request) },
                )
            }
        }
    }
}

@Composable
private fun LivePostBuilderSection(
    selectedGuildName: String,
    announceChannel: String,
    postChannel: String,
    draftTargets: List<String>,
    draftPostText: String,
    draftLinkUrl: String,
    draftMediaCount: Int,
    dispatchCount: Int,
    onQueueLivePost: () -> Unit,
) {
    SectionCard(
        title = "Override post",
        subtitle = "Use this only when you need to boost or re-run an automation manually.",
        content = {
        InfoLine("Guild", selectedGuildName.ifBlank { "Choose in Config" })
        InfoLine("Live alerts", announceChannel.ifBlank { "Set in Config" })
        InfoLine("Post channel", postChannel.ifBlank { "Set in Config" })
        InfoLine("Targets", draftTargets.joinToString(", ").ifBlank { "Choose socials above" })
        InfoLine("Media attached", draftMediaCount.toString())
        InfoLine("Queued items", dispatchCount.toString())
        Surface(
            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.72f),
            shape = RoundedCornerShape(18.dp),
        ) {
            Column(
                modifier = Modifier.padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(
                    text = "Live post summary",
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Text(
                    text = draftPostText.ifBlank { "Your live alert copy will appear here." },
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                if (draftLinkUrl.isNotBlank()) {
                    Text(
                        text = draftLinkUrl,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
            }
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            FilledTonalButton(
                onClick = onQueueLivePost,
                modifier = Modifier.weight(1f),
                enabled = draftPostText.isNotBlank() || draftMediaCount > 0,
            ) {
                Text("Queue live post")
            }
            FilledTonalButton(onClick = {}, modifier = Modifier.weight(1f), enabled = false) {
                Text("Send test later")
            }
        }
        },
    )
}

@Composable
private fun HeroCard(imageCount: Int, videoCount: Int, selectedCount: Int) {
    ElevatedCard(
        colors = CardDefaults.elevatedCardColors(containerColor = Color.Transparent),
        elevation = CardDefaults.elevatedCardElevation(defaultElevation = 6.dp),
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .background(
                    brush = Brush.linearGradient(
                        colors = listOf(
                            MaterialTheme.colorScheme.primary.copy(alpha = 0.20f),
                            MaterialTheme.colorScheme.secondary.copy(alpha = 0.22f),
                            MaterialTheme.colorScheme.tertiary.copy(alpha = 0.18f),
                        ),
                    ),
                    shape = RoundedCornerShape(28.dp),
                )
                .padding(20.dp),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Image(
                    painter = painterResource(id = R.drawable.watchme_overlay_clean),
                    contentDescription = "WatchMe overlay",
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(170.dp),
                    contentScale = ContentScale.Fit,
                )
                Text(
                    text = "WatchMe on the fly",
                    style = MaterialTheme.typography.headlineSmall,
                )
                Text(
                    text = "One mobile home for creator links, live checks, and a quick-grab image/video library.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    StatCard(
                        label = "Images",
                        value = imageCount.toString(),
                        modifier = Modifier.weight(1f),
                    )
                    StatCard(
                        label = "Videos",
                        value = videoCount.toString(),
                        modifier = Modifier.weight(1f),
                    )
                    StatCard(
                        label = "Selected",
                        value = selectedCount.toString(),
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }
    }
}

@Composable
private fun StatCard(label: String, value: String, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier,
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.78f),
        contentColor = MaterialTheme.colorScheme.onSurface,
        shape = RoundedCornerShape(20.dp),
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                text = value,
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Text(
                text = label,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun StatusCard(message: String) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.88f),
        shape = RoundedCornerShape(20.dp),
    ) {
        Text(
            text = message,
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}

@Composable
private fun HomeDiscordEmbedDashboardCard(
    liveStatusLine: String,
    creatorsLiveCount: Int,
    creatorDisplayName: String,
    twitchUrl: String,
    youtubeUrl: String,
    kickUrl: String,
) {
    val context = LocalContext.current
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = Color(0xFF111214),
        shape = RoundedCornerShape(20.dp),
        border = BorderStroke(1.dp, Color(0xFF2B3038)),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text(
                text = "Live snapshot",
                style = MaterialTheme.typography.titleMedium,
                color = Color(0xFFE4E9F2),
                fontWeight = FontWeight.SemiBold,
            )
            HorizontalDivider(color = Color(0xFF2F343D))
            Text(
                text = "STATUS",
                style = MaterialTheme.typography.labelSmall,
                color = Color(0xFF94A3B8),
                letterSpacing = 0.8.sp,
            )
            Text(
                text = buildString {
                    append(liveStatusLine.ifBlank { "No live telemetry yet." })
                    if (creatorsLiveCount > 0) {
                        append(" · ")
                        append(creatorsLiveCount)
                        append(" creator")
                        append(if (creatorsLiveCount == 1) "" else "s")
                        append(" live")
                    }
                },
                style = MaterialTheme.typography.bodyMedium,
                color = Color(0xFFB8C5D9),
                lineHeight = 20.sp,
            )
            HorizontalDivider(color = Color(0xFF2F343D))
            Text(
                text = "CREATOR",
                style = MaterialTheme.typography.labelSmall,
                color = Color(0xFF94A3B8),
                letterSpacing = 0.8.sp,
            )
            Text(
                text = creatorDisplayName.ifBlank { "—" },
                style = MaterialTheme.typography.headlineSmall,
                color = Color(0xFFF8FAFF),
                fontWeight = FontWeight.Bold,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            HorizontalDivider(color = Color(0xFF2F343D))
            Text(
                text = "SOCIAL LINKS",
                style = MaterialTheme.typography.labelSmall,
                color = Color(0xFF94A3B8),
                letterSpacing = 0.8.sp,
            )
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                val links = listOfNotNull(
                    twitchUrl.trim().takeIf { it.isNotBlank() }?.let { "Twitch" to it },
                    youtubeUrl.trim().takeIf { it.isNotBlank() }?.let { "YouTube" to it },
                    kickUrl.trim().takeIf { it.isNotBlank() }?.let { "Kick" to it },
                )
                if (links.isEmpty()) {
                    Text(
                        text = "Add profile links in Settings → Profile.",
                        style = MaterialTheme.typography.bodySmall,
                        color = Color(0xFF7C8594),
                    )
                } else {
                    links.forEach { pair ->
                        val label = pair.first
                        val rowUrl = pair.second
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                text = label,
                                style = MaterialTheme.typography.labelLarge,
                                color = Color(0xFF7C9CFF),
                            )
                            Text(
                                text = rowUrl,
                                style = MaterialTheme.typography.bodySmall,
                                color = Color(0xFF9FB0C8),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier
                                    .weight(1f)
                                    .padding(start = 10.dp)
                                    .clickable {
                                        openExternalUrl(context, rowUrl)
                                    },
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun BrandedWorkspaceBanner(
) {
    Box(
        modifier = Modifier.fillMaxWidth(),
        contentAlignment = Alignment.Center,
    ) {
        Image(
            painter = painterResource(id = R.drawable.watchme_overlay_clean),
            contentDescription = "WatchMe banner",
            modifier = Modifier
                .fillMaxWidth()
                .height(84.dp),
            contentScale = ContentScale.Fit,
        )
    }
}

@Composable
private fun SectionCard(
    title: String,
    subtitle: String,
    content: @Composable () -> Unit,
) {
    Surface(
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.94f),
        contentColor = MaterialTheme.colorScheme.onSurface,
        shape = RoundedCornerShape(20.dp),
        border = BorderStroke(1.dp, Color(0x1E7C9CFF)),
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                VerifiedProBadge(compact = true, contentDescription = "WatchMe mark")
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                )
            }
            if (subtitle.isNotBlank()) {
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            content()
        }
    }
}

@Composable
private fun StepSectionCard(
    step: Int,
    title: String,
    subtitle: String,
    content: @Composable () -> Unit,
) {
    Surface(
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.94f),
        contentColor = MaterialTheme.colorScheme.onSurface,
        shape = RoundedCornerShape(18.dp),
        border = BorderStroke(1.dp, Color(0x2E7C9CFF)),
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Surface(
                    color = MaterialTheme.colorScheme.primary.copy(alpha = 0.16f),
                    contentColor = MaterialTheme.colorScheme.primary,
                    shape = RoundedCornerShape(999.dp),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.45f)),
                ) {
                    Text(
                        text = "STEP $step",
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.Black,
                        maxLines = 1,
                    )
                }
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.weight(1f),
                )
            }
            if (subtitle.isNotBlank()) {
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            content()
        }
    }
}

@Composable
private fun watchMeChipColors() = FilterChipDefaults.filterChipColors(
    labelColor = MaterialTheme.colorScheme.onSurfaceVariant,
    selectedLabelColor = MaterialTheme.colorScheme.onSurface,
    selectedContainerColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.18f),
    containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.62f),
)

@Composable
private fun CurrentSelectionCard(
    title: String,
    value: String,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f),
        shape = RoundedCornerShape(16.dp),
        border = BorderStroke(1.dp, Color(0x1E7C9CFF)),
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontWeight = FontWeight.Bold,
            )
            Text(
                text = value,
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun MonitorSwitchRow(
    title: String,
    description: String,
    checked: Boolean,
    enabled: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f),
        shape = RoundedCornerShape(20.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(text = title, style = MaterialTheme.typography.titleMedium)
                if (description.isNotBlank()) {
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = description,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            Switch(
                checked = checked,
                onCheckedChange = onCheckedChange,
                enabled = enabled,
            )
        }
    }
}

@Composable
private fun SelectionToolbar(
    selectedCount: Int,
    onSelectAll: () -> Unit,
    onRemoveSelected: () -> Unit,
) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f),
        shape = RoundedCornerShape(18.dp),
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(
                text = "$selectedCount selected",
                style = MaterialTheme.typography.titleMedium,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = onSelectAll) {
                    Text("Select all")
                }
                TextButton(
                    onClick = onRemoveSelected,
                    enabled = selectedCount > 0,
                ) {
                    Text("Remove selected")
                }
            }
        }
    }
}

@Composable
private fun ImageLibraryGrid(
    items: List<MediaLibraryItem>,
    selectedUris: Set<String>,
    onToggleSelected: (String) -> Unit,
    onPreview: (MediaLibraryItem) -> Unit,
    onRemove: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        items.chunked(2).forEach { rowItems ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                rowItems.forEach { item ->
                    ImageLibraryCard(
                        item = item,
                        selected = item.uriString in selectedUris,
                        onToggleSelected = { onToggleSelected(item.uriString) },
                        onPreview = { onPreview(item) },
                        onRemove = { onRemove(item.uriString) },
                        modifier = Modifier.weight(1f),
                    )
                }
                if (rowItems.size == 1) {
                    Spacer(modifier = Modifier.weight(1f))
                }
            }
        }
    }
}

@Composable
private fun ImageLibraryCard(
    item: MediaLibraryItem,
    selected: Boolean,
    onToggleSelected: () -> Unit,
    onPreview: () -> Unit,
    onRemove: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(24.dp),
        color = if (selected) {
            MaterialTheme.colorScheme.primary.copy(alpha = 0.12f)
        } else {
            MaterialTheme.colorScheme.surface
        },
        tonalElevation = if (selected) 6.dp else 2.dp,
        border = if (selected) {
            BorderStroke(2.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.60f))
        } else {
            null
        },
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(onClick = onToggleSelected)
                .animateContentSize(),
        ) {
            AsyncImage(
                model = ImageRequest.Builder(LocalContext.current)
                    .data(item.uri)
                    .crossfade(true)
                    .build(),
                contentDescription = item.name,
                contentScale = ContentScale.Crop,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(150.dp)
                    .clip(RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)),
            )
            Column(
                modifier = Modifier.padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    text = item.name,
                    style = MaterialTheme.typography.titleMedium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = item.detailLine,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    text = if (selected) "Selected for quick use" else "Tap card to select",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    TextButton(onClick = onPreview) {
                        Text("Preview")
                    }
                    TextButton(onClick = onRemove) {
                        Text("Remove")
                    }
                }
            }
        }
    }
}

@Composable
private fun VideoLibraryList(
    items: List<MediaLibraryItem>,
    selectedUris: Set<String>,
    onToggleSelected: (String) -> Unit,
    onPreview: (MediaLibraryItem) -> Unit,
    onRemove: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        items.forEach { item ->
            VideoLibraryCard(
                item = item,
                selected = item.uriString in selectedUris,
                onToggleSelected = { onToggleSelected(item.uriString) },
                onPreview = { onPreview(item) },
                onRemove = { onRemove(item.uriString) },
            )
        }
    }
}

@Composable
private fun VideoLibraryCard(
    item: MediaLibraryItem,
    selected: Boolean,
    onToggleSelected: () -> Unit,
    onPreview: () -> Unit,
    onRemove: () -> Unit,
) {
    Surface(
        shape = RoundedCornerShape(24.dp),
        color = if (selected) {
            MaterialTheme.colorScheme.secondary.copy(alpha = 0.12f)
        } else {
            MaterialTheme.colorScheme.surface
        },
        tonalElevation = if (selected) 6.dp else 2.dp,
        border = if (selected) {
            BorderStroke(2.dp, MaterialTheme.colorScheme.secondary.copy(alpha = 0.70f))
        } else {
            null
        },
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(onClick = onToggleSelected)
                .animateContentSize(),
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(132.dp)
                    .background(
                        Brush.linearGradient(
                            colors = listOf(
                                MaterialTheme.colorScheme.tertiary.copy(alpha = 0.28f),
                                MaterialTheme.colorScheme.primary.copy(alpha = 0.20f),
                                MaterialTheme.colorScheme.secondary.copy(alpha = 0.24f),
                            ),
                        ),
                    )
                    .padding(16.dp),
            ) {
                Column(
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                    modifier = Modifier.align(Alignment.BottomStart),
                ) {
                    Text(
                        text = "VIDEO LIBRARY",
                        style = MaterialTheme.typography.labelLarge,
                    )
                    item.durationMs?.let {
                        Text(
                            text = formatDuration(it),
                            style = MaterialTheme.typography.titleMedium,
                        )
                    }
                }
            }
            Column(
                modifier = Modifier.padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    text = item.name,
                    style = MaterialTheme.typography.titleMedium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = item.detailLine,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    text = if (selected) "Selected for quick use" else "Tap card to select",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.secondary,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    TextButton(onClick = onPreview) {
                        Text("Preview")
                    }
                    TextButton(onClick = onRemove) {
                        Text("Remove")
                    }
                }
            }
        }
    }
}

@Composable
private fun EmptyLibraryCard(title: String, body: String) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f),
        shape = RoundedCornerShape(22.dp),
    ) {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(text = title, style = MaterialTheme.typography.titleMedium)
            Text(
                text = body,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AttachedMediaCard(
    items: List<MediaLibraryItem>,
    onRemove: (String) -> Unit,
) {
    Surface(
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.90f),
        shape = RoundedCornerShape(20.dp),
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(
                text = "Attached media (${items.size})",
                style = MaterialTheme.typography.titleSmall,
            )
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items.forEach { item ->
                    Surface(
                        shape = RoundedCornerShape(16.dp),
                        color = MaterialTheme.colorScheme.primary.copy(alpha = 0.08f),
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Text(
                                text = item.name,
                                style = MaterialTheme.typography.bodySmall,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.width(140.dp),
                            )
                            TextButton(onClick = { onRemove(item.uriString) }) {
                                Text("Remove")
                            }
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TemplateSummaryCard(
    template: CreatorPostTemplate,
    mediaCount: Int,
    onLoad: () -> Unit,
    onDelete: () -> Unit,
) {
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(20.dp),
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = template.name,
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Text(
                        text = formatStudioTimestamp(template.updatedAtEpochMs),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (template.isDefault) {
                    Surface(
                        color = MaterialTheme.colorScheme.secondary.copy(alpha = 0.15f),
                        shape = RoundedCornerShape(999.dp),
                    ) {
                        Text(
                            text = "Default",
                            style = MaterialTheme.typography.labelMedium,
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                        )
                    }
                }
            }
            if (template.postText.isNotBlank()) {
                Text(
                    text = template.postText,
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                template.targetPlatforms.forEach { platform ->
                    FilterChip(
                        selected = true,
                        onClick = onLoad,
                        label = { PlatformChipLabel(platform) },
                    )
                }
                if (mediaCount > 0) {
                    FilterChip(
                        selected = true,
                        onClick = onLoad,
                        label = { Text("$mediaCount media") },
                    )
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = onLoad) {
                    Text("Load")
                }
                TextButton(onClick = onDelete) {
                    Text("Delete")
                }
            }
        }
    }
}

@Composable
private fun ConnectionSummaryCard(
    connection: CreatorSocialConnection,
    onEdit: () -> Unit,
) {
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(20.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            PlatformLogoImage(
                platform = connection.platform,
                contentDescription = "${platformDisplayName(connection.platform)} logo",
            )
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = platformDisplayName(connection.platform),
                    style = MaterialTheme.typography.titleSmall,
                )
                Text(
                    text = connection.externalAccountName.ifBlank {
                        connection.externalAccountId.ifBlank { "Account not named yet" }
                    },
                    style = MaterialTheme.typography.bodyMedium,
                )
                Text(
                    text = "Status: ${connection.status}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            TextButton(onClick = onEdit) {
                Text("Edit")
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DispatchSummaryCard(
    dispatch: CreatorDispatchRecord,
    onReuse: () -> Unit,
) {
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(20.dp),
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = dispatch.templateName,
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Text(
                        text = formatStudioTimestamp(dispatch.createdAtEpochMs),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Surface(
                    color = MaterialTheme.colorScheme.primary.copy(alpha = 0.12f),
                    shape = RoundedCornerShape(999.dp),
                ) {
                    Text(
                        text = dispatch.status.replace('_', ' '),
                        style = MaterialTheme.typography.labelMedium,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                    )
                }
            }
            if (dispatch.note.isNotBlank()) {
                Text(
                    text = dispatch.note,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                dispatch.targetPlatforms.forEach { platform ->
                    FilterChip(
                        selected = true,
                        onClick = onReuse,
                        label = { PlatformChipLabel(platform) },
                    )
                }
                if (dispatch.mediaUris.isNotEmpty()) {
                    FilterChip(
                        selected = true,
                        onClick = onReuse,
                        label = { Text("${dispatch.mediaUris.size} media") },
                    )
                }
            }
            TextButton(onClick = onReuse) {
                Text("Use again")
            }
        }
    }
}

private data class CreatorLinks(
    val twitchUrl: String = "",
    val youtubeUrl: String = "",
    val kickUrl: String = "",
    val discordUserId: String = "",
    val displayNickname: String = "",
    val pingRoleId: String = "",
    val pingMemberId: String = "",
    val avatarUrl: String = "",
    val freeformNotes: String = "",
)

private fun buildCreatorLinksJson(
    twitchUrl: String,
    youtubeUrl: String,
    kickUrl: String,
    discordUserId: String = "",
    displayNickname: String = "",
    pingRoleId: String = "",
    pingMemberId: String = "",
    avatarUrl: String = "",
    freeformNotes: String = "",
): String {
    return JSONObject()
        .put("twitch_url", twitchUrl.trim())
        .put("youtube_url", youtubeUrl.trim())
        .put("kick_url", kickUrl.trim())
        .put("discord_user_id", discordUserId.trim())
        .put("display_nickname", displayNickname.trim())
        .put("ping_role_id", pingRoleId.trim())
        .put("ping_member_id", pingMemberId.trim())
        .put("avatar_url", avatarUrl.trim())
        .put("notes", freeformNotes.trim())
        .toString()
}

private fun mergeCreatorExtrasIntoNotesJson(
    previous: CreatorLinks?,
    discordUserId: String,
    twitchUrl: String,
    youtubeUrl: String,
    kickUrl: String,
    avatarUrl: String = "",
    freeformNotes: String,
): String {
    val prior = previous ?: CreatorLinks()
    val nextAvatar = avatarUrl.trim().ifBlank { prior.avatarUrl }
    return buildCreatorLinksJson(
        twitchUrl = twitchUrl,
        youtubeUrl = youtubeUrl,
        kickUrl = kickUrl,
        discordUserId = discordUserId.ifBlank { prior.discordUserId },
        displayNickname = prior.displayNickname,
        pingRoleId = prior.pingRoleId,
        pingMemberId = prior.pingMemberId,
        avatarUrl = nextAvatar,
        freeformNotes = freeformNotes.ifBlank { prior.freeformNotes },
    )
}

private fun parseCreatorLinks(raw: String): CreatorLinks {
    val trimmed = raw.trim()
    if (trimmed.isEmpty()) return CreatorLinks()

    val jsonParsed = runCatching { JSONObject(trimmed) }.getOrNull()
    if (jsonParsed != null) {
        return CreatorLinks(
            twitchUrl = jsonParsed.optString("twitch_url"),
            youtubeUrl = jsonParsed.optString("youtube_url"),
            kickUrl = jsonParsed.optString("kick_url"),
            discordUserId = jsonParsed.optString("discord_user_id"),
            displayNickname = jsonParsed.optString("display_nickname"),
            pingRoleId = jsonParsed.optString("ping_role_id"),
            pingMemberId = jsonParsed.optString("ping_member_id"),
            avatarUrl = jsonParsed.optString("avatar_url"),
            freeformNotes = jsonParsed.optString("notes"),
        )
    }

    val legacyDiscord = Regex(
        pattern = """Discord\s*ID:\s*(\S+)""",
        option = RegexOption.IGNORE_CASE,
    ).find(trimmed)?.groupValues?.getOrNull(1)?.trim().orEmpty()

    return CreatorLinks(freeformNotes = trimmed, discordUserId = legacyDiscord)
}

private fun extractDiscordUserIdFromNotes(raw: String): String {
    val parsed = parseCreatorLinks(raw)
    if (parsed.discordUserId.isNotBlank()) return parsed.discordUserId.trim()
    return Regex(
        pattern = """Discord\s*ID:\s*(\S+)""",
        option = RegexOption.IGNORE_CASE,
    ).find(raw)?.groupValues?.getOrNull(1)?.trim().orEmpty()
}

private fun primaryCreatorPlatformTag(
    twitchUrl: String,
    youtubeUrl: String,
    kickUrl: String,
    fallbackPlatform: String,
): String {
    val tag = when {
        twitchUrl.isNotBlank() -> "twitch"
        youtubeUrl.isNotBlank() -> "youtube"
        kickUrl.isNotBlank() -> "kick"
        else -> ""
    }
    val trimmedFallback = fallbackPlatform.trim().lowercase(Locale.getDefault())
    return tag.ifBlank { trimmedFallback }.ifBlank { "discord" }
}

private fun resolveCreatorProfileId(
    selectedGuildId: String,
    editingLocalId: String?,
    rosterDiscordUserId: String,
    manualDiscordSnowflake: String,
    memberName: String,
    twitchUrl: String,
    youtubeUrl: String,
    kickUrl: String,
): String {
    val prefix = "server-${selectedGuildId}-"
    val existing = editingLocalId
        ?.takeIf { selectedGuildId.isNotBlank() && it.startsWith(prefix) }
        ?.removePrefix(prefix)
        ?.trim()
        .orEmpty()
    if (existing.isNotBlank()) return existing

    val rosterPick = rosterDiscordUserId.trim().ifBlank { manualDiscordSnowflake.trim() }
    if (rosterPick.isNotBlank()) return rosterPick

    val seed = listOf(memberName, twitchUrl, youtubeUrl, kickUrl)
        .joinToString("|") { it.trim().lowercase(Locale.getDefault()) }
        .ifBlank { "creator-${System.currentTimeMillis()}" }
    return "manual-${seed.hashCode().toUInt().toString(16)}"
}

@Composable
private fun MemberRequestCard(
    request: MemberRequestItem,
    onRemove: () -> Unit,
) {
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(20.dp),
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = request.memberName.ifBlank { "Unnamed creator" },
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Text(
                        text = request.requestType.replaceFirstChar { it.uppercase() },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                TextButton(onClick = onRemove) {
                    Text("Remove")
                }
            }
            if (request.platform.isNotBlank()) {
                Text(
                    text = "Platform / Channel: ${request.platform}",
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            if (request.notes.isNotBlank()) {
                Text(
                    text = request.notes,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            Text(
                text = formatStudioTimestamp(request.createdAtEpochMs),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CreatorRosterCard(
    request: MemberRequestItem,
    onEdit: () -> Unit,
    onApprove: () -> Unit,
    onMoveToPending: () -> Unit,
    onRemove: () -> Unit,
) {
    val links = parseCreatorLinks(request.notes)
    val context = LocalContext.current
    val isPending = request.status.equals("pending_approval", ignoreCase = true)
    val statusColor = if (isPending) {
        MaterialTheme.colorScheme.secondary
    } else {
        MaterialTheme.colorScheme.primary
    }
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = Color(0xFF101B2D),
        contentColor = MaterialTheme.colorScheme.onSurface,
        shape = RoundedCornerShape(16.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.Top,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                val logoPlatform = request.platform.ifBlank { "discord" }
                val avatarRemote = links.avatarUrl.trim().takeIf { it.startsWith("http", ignoreCase = true) }
                Surface(
                    modifier = Modifier.size(46.dp),
                    shape = CircleShape,
                    color = MaterialTheme.colorScheme.primary.copy(alpha = 0.14f),
                    tonalElevation = 0.dp,
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.35f)),
                ) {
                    Box(
                        contentAlignment = Alignment.Center,
                        modifier = Modifier.fillMaxSize(),
                    ) {
                        if (avatarRemote != null) {
                            AsyncImage(
                                model = ImageRequest.Builder(context).data(avatarRemote).crossfade(true).build(),
                                contentDescription = "Creator avatar",
                                modifier = Modifier
                                    .size(46.dp)
                                    .clip(CircleShape),
                                contentScale = ContentScale.Crop,
                            )
                        } else {
                            PlatformLogoImage(
                                platform = logoPlatform,
                                compact = true,
                                contentDescription = "${platformDisplayName(logoPlatform)} channel",
                            )
                        }
                    }
                }
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Text(
                        text = links.displayNickname.ifBlank {
                            request.memberName.ifBlank { "Unnamed creator" }
                        },
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                    if (links.displayNickname.isNotBlank() &&
                        !links.displayNickname.equals(request.memberName, ignoreCase = true)
                    ) {
                        Text(
                            text = "Server handle: ${request.memberName}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    Text(
                        text = if (isPending) "Pending approval" else "Linked member",
                        style = MaterialTheme.typography.bodySmall,
                        color = statusColor,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Surface(
                    color = statusColor.copy(alpha = 0.14f),
                    contentColor = statusColor,
                    shape = RoundedCornerShape(999.dp),
                ) {
                    Text(
                        text = if (isPending) "Pending" else "Linked",
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                    )
                }
            }
            if (request.platform.isNotBlank()) {
                Text(
                    text = "${platformDisplayName(request.platform)} alerts",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (links.pingRoleId.isNotBlank() || links.pingMemberId.isNotBlank()) {
                Text(
                    text = buildString {
                        append("Ping: ")
                        val parts = mutableListOf<String>()
                        if (links.pingRoleId.isNotBlank()) {
                            parts += "role ${links.pingRoleId}"
                        }
                        if (links.pingMemberId.isNotBlank()) {
                            parts += "member ${links.pingMemberId}"
                        }
                        append(parts.joinToString(" · "))
                    },
                    style = MaterialTheme.typography.labelSmall,
                    color = Color(0xFF9FB0C8),
                )
            }
            val platforms = listOfNotNull(
                links.twitchUrl.takeIf { it.isNotBlank() }?.let { "Twitch" },
                links.youtubeUrl.takeIf { it.isNotBlank() }?.let { "YouTube" },
                links.kickUrl.takeIf { it.isNotBlank() }?.let { "Kick" },
            )
            if (platforms.isNotEmpty()) {
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    platforms.forEach { label ->
                        FilterChip(
                            selected = true,
                            onClick = {},
                            label = {
                                Text(
                                    text = label,
                                    color = MaterialTheme.colorScheme.onSurface,
                                    maxLines = 1,
                                )
                            },
                        )
                    }
                }
            }
            if (links.freeformNotes.isNotBlank()) {
                Text(
                    text = links.freeformNotes,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            FlowRow(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                TextButton(
                    onClick = onEdit,
                    colors = ButtonDefaults.textButtonColors(
                        contentColor = MaterialTheme.colorScheme.primary,
                    ),
                ) {
                    Text("Edit")
                }
                TextButton(
                    onClick = if (isPending) onApprove else onMoveToPending,
                    colors = ButtonDefaults.textButtonColors(
                        contentColor = MaterialTheme.colorScheme.primary,
                    ),
                ) {
                    Text(if (isPending) "Approve" else "Pending")
                }
                TextButton(
                    onClick = onRemove,
                    colors = ButtonDefaults.textButtonColors(
                        contentColor = Color(0xFFFF8A8A),
                    ),
                ) {
                    Text("Remove")
                }
            }
        }
    }
}

@Composable
private fun rememberMediaItems(
    context: Context,
    uriStrings: List<String>,
    kind: MediaKind,
): State<List<MediaLibraryItem>> = produceState(
    initialValue = emptyList(),
    context,
    uriStrings,
    kind,
) {
    value = withContext(Dispatchers.IO) {
        uriStrings.mapNotNull { resolveMediaItem(context, it, kind) }
    }
}

private fun resolveMediaItem(
    context: Context,
    uriString: String,
    kind: MediaKind,
): MediaLibraryItem? = runCatching {
    val uri = Uri.parse(uriString)
    val resolver = context.contentResolver

    var name = uri.lastPathSegment ?: if (kind == MediaKind.IMAGE) "Image asset" else "Video asset"
    var sizeBytes: Long? = null

    resolver.query(
        uri,
        arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE),
        null,
        null,
        null,
    )?.use { cursor ->
        if (cursor.moveToFirst()) {
            val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (nameIndex >= 0 && !cursor.isNull(nameIndex)) {
                name = cursor.getString(nameIndex)
            }

            val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
            if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) {
                sizeBytes = cursor.getLong(sizeIndex)
            }
        }
    }

    val mimeType = resolver.getType(uri).orEmpty().ifBlank {
        if (kind == MediaKind.IMAGE) "image/*" else "video/*"
    }
    val durationMs = if (kind == MediaKind.VIDEO) readVideoDuration(context, uri) else null

    val detailParts = mutableListOf<String>()
    sizeBytes?.let { detailParts += formatFileSize(it) }
    if (kind == MediaKind.VIDEO) {
        durationMs?.let { detailParts += formatDuration(it) }
    }
    detailParts += formatMimeType(mimeType)

    MediaLibraryItem(
        uriString = uriString,
        name = name,
        mimeType = mimeType,
        detailLine = detailParts.filter { it.isNotBlank() }.joinToString(" | "),
        kind = kind,
        durationMs = durationMs,
    )
}.getOrNull()

private fun readVideoDuration(context: Context, uri: Uri): Long? {
    var retriever: MediaMetadataRetriever? = null
    return try {
        retriever = MediaMetadataRetriever()
        retriever.setDataSource(context, uri)
        retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
    } catch (_: Exception) {
        null
    } finally {
        runCatching { retriever?.release() }
    }
}

private fun persistReadAccess(context: Context, uris: List<Uri>) {
    uris.forEach { uri ->
        try {
            context.contentResolver.takePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION,
            )
        } catch (_: Exception) {
        }
    }
}

private fun mergeRecentUris(existing: List<String>, incoming: List<Uri>): List<String> {
    return (incoming.map(Uri::toString) + existing)
        .distinct()
        .take(40)
}

private fun platformCallToAction(platform: String): String {
    return when (platform.trim().lowercase(Locale.getDefault())) {
        "discord" -> "Open in Discord"
        "youtube", "yt" -> "Watch on YouTube"
        "twitch" -> "Watch on Twitch"
        "facebook", "fb" -> "View on Facebook"
        "instagram", "ig" -> "View on Instagram"
        "x", "twitter" -> "Open on X"
        "tiktok", "tt" -> "Watch on TikTok"
        "kick" -> "Watch on Kick"
        else -> "Open link"
    }
}

private fun previewCopyForPlatform(platform: String, headline: String): String {
    val safeHeadline = headline.ifBlank { "Your post copy will appear here." }
    return when (platform.trim().lowercase(Locale.getDefault())) {
        "discord" -> safeHeadline
        "youtube", "yt" -> "YouTube community: $safeHeadline"
        "twitch" -> "Twitch alert: $safeHeadline"
        "facebook", "fb" -> "Facebook post: $safeHeadline"
        "instagram", "ig" -> "Instagram caption: $safeHeadline"
        "x", "twitter" -> "X post: $safeHeadline"
        "tiktok", "tt" -> "TikTok caption: $safeHeadline"
        "kick" -> "Kick update: $safeHeadline"
        else -> safeHeadline
    }
}

private fun toggleSelection(target: MutableList<String>, uriString: String) {
    if (!target.remove(uriString)) {
        target.add(uriString)
    }
}

private fun openMedia(context: Context, uri: Uri, mimeType: String): Boolean {
    val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, mimeType)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    return try {
        context.startActivity(intent)
        true
    } catch (_: ActivityNotFoundException) {
        false
    }
}

private fun openExternalUrl(context: Context, url: String): Boolean {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    return try {
        context.startActivity(intent)
        true
    } catch (_: ActivityNotFoundException) {
        false
    }
}

private fun parseIsoDateOrToday(value: String): LocalDate {
    return runCatching { LocalDate.parse(value.trim(), DateTimeFormatter.ISO_LOCAL_DATE) }
        .getOrDefault(LocalDate.now())
}

private fun scheduleEpochMillisOrNow(date: String, time: String): Long {
    return runCatching {
        val localDate = parseIsoDateOrToday(date)
        val localTime = LocalTime.parse(time.trim(), DateTimeFormatter.ofPattern("H:mm"))
        LocalDateTime.of(localDate, localTime)
            .atZone(ZoneId.systemDefault())
            .toInstant()
            .toEpochMilli()
    }.getOrDefault(System.currentTimeMillis())
}

private fun formatIsoDate(epochMs: Long): String {
    return LocalDateTime.ofInstant(
        java.time.Instant.ofEpochMilli(epochMs),
        ZoneId.systemDefault(),
    ).toLocalDate().format(DateTimeFormatter.ISO_LOCAL_DATE)
}

private fun formatIsoDate(date: LocalDate): String = date.format(DateTimeFormatter.ISO_LOCAL_DATE)

private fun dayOfWeekLabel(date: LocalDate): String =
    date.dayOfWeek.name.lowercase().replaceFirstChar { it.uppercase() }.take(3)

private fun monthDayLabel(date: LocalDate): String =
    date.format(DateTimeFormatter.ofPattern("MMM d"))

private fun prettyDateLabel(date: LocalDate): String =
    date.format(DateTimeFormatter.ofPattern("EEEE, d MMMM"))

private fun timeOnlyLabel(epochMs: Long): String {
    return LocalDateTime.ofInstant(
        java.time.Instant.ofEpochMilli(epochMs),
        ZoneId.systemDefault(),
    ).toLocalTime().format(DateTimeFormatter.ofPattern("HH:mm"))
}
