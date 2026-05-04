package com.watchme.app

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val WatchMeColors = darkColorScheme(
    primary = Color(0xFF7C9CFF),
    onPrimary = Color(0xFFE5EDF8),
    primaryContainer = Color(0xFF13203A),
    onPrimaryContainer = Color(0xFFE5EDF8),
    secondary = Color(0xFF4299E1),
    onSecondary = Color(0xFFE5EDF8),
    secondaryContainer = Color(0xFF13273C),
    onSecondaryContainer = Color(0xFFE5EDF8),
    tertiary = Color(0xFF7C9CFF),
    onTertiary = Color(0xFFE5EDF8),
    tertiaryContainer = Color(0xFF13273C),
    onTertiaryContainer = Color(0xFFE5EDF8),
    background = Color(0xFF07101D),
    onBackground = Color(0xFFE5EDF8),
    surface = Color(0xFF0B1524),
    onSurface = Color(0xFFE5EDF8),
    surfaceVariant = Color(0xFF101B2D),
    onSurfaceVariant = Color(0xFF9FB0C8),
)

@Composable
fun WatchMeTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = WatchMeColors,
        typography = Typography(),
        content = content,
    )
}

@Composable
fun WatchMeVerifiedMark() {
    Surface(
        shape = RoundedCornerShape(32.dp),
        color = Color.Transparent,
    ) {
        Image(
            painter = painterResource(id = R.drawable.watchme_overlay_clean),
            contentDescription = "WatchMe overlay",
            modifier = Modifier
                .fillMaxWidth()
                .height(170.dp),
            contentScale = ContentScale.Fit,
        )
    }
}

@Composable
fun WatchMeLogoBadge(
    modifier: Modifier = Modifier,
    active: Boolean = true,
    compact: Boolean = false,
    contentDescription: String? = "WatchMe Pro logo",
) {
    val badgeSize = if (compact) 44.dp else 70.dp

    Image(
        painter = painterResource(id = R.drawable.logo_watchme_pro_mark),
        contentDescription = contentDescription,
        modifier = modifier.size(badgeSize),
        contentScale = ContentScale.Fit,
        alpha = if (active) 1f else 0.55f,
    )
}

@Composable
fun VerifiedProBadge(
    modifier: Modifier = Modifier,
    active: Boolean = true,
    compact: Boolean = false,
    contentDescription: String? = "Verified Pro member logo",
) {
    val badgeSize = if (compact) 34.dp else 54.dp

    Image(
        painter = painterResource(id = R.drawable.logo_watchme_mark),
        contentDescription = contentDescription,
        modifier = modifier.size(badgeSize),
        contentScale = ContentScale.Fit,
        alpha = if (active) 1f else 0.55f,
    )
}

@Composable
fun PlatformLogoImage(
    platform: String,
    modifier: Modifier = Modifier,
    active: Boolean = true,
    compact: Boolean = false,
    contentDescription: String? = "${platformDisplayName(platform)} logo",
) {
    val logoSize = if (compact) 32.dp else 44.dp
    val logoRes = platformLogoRes(platform)

    if (logoRes == null) {
        PlatformLogoFallback(
            platform = platform,
            modifier = modifier,
            active = active,
            compact = compact,
        )
        return
    }

    Image(
        painter = painterResource(id = logoRes),
        contentDescription = contentDescription,
        modifier = modifier
            .size(logoSize)
            .clip(RoundedCornerShape(if (compact) 8.dp else 12.dp)),
        contentScale = ContentScale.Fit,
        alpha = if (active) 1f else 0.55f,
    )
}

@Composable
private fun PlatformLogoFallback(
    platform: String,
    modifier: Modifier = Modifier,
    active: Boolean = true,
    compact: Boolean = false,
) {
    val badgeSize = if (compact) 32.dp else 44.dp
    val markTextSize = if (compact) 11.sp else 13.sp
    Surface(
        modifier = modifier.size(badgeSize),
        shape = RoundedCornerShape(if (compact) 8.dp else 12.dp),
        color = MaterialTheme.colorScheme.secondary.copy(alpha = if (active) 1f else 0.42f),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Box(contentAlignment = Alignment.Center) {
            Text(
                text = platformMonogram(platform),
                style = MaterialTheme.typography.labelSmall,
                fontSize = markTextSize,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSecondary,
                textAlign = TextAlign.Center,
            )
        }
    }
}

@Composable
fun PlatformChipLabel(platform: String) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        PlatformLogoImage(
            platform = platform,
            compact = true,
            contentDescription = "${platformDisplayName(platform)} logo",
        )
        Text(platformDisplayName(platform))
    }
}
