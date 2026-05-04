package com.watchme.app

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent

interface DiscordAuthLauncher {
    fun launchAuthorization(
        activity: Activity,
        authorizationUrl: String,
        onLaunchFailure: (String) -> Unit,
    )
}

object StandardDiscordOAuthLauncher : DiscordAuthLauncher {
    override fun launchAuthorization(
        activity: Activity,
        authorizationUrl: String,
        onLaunchFailure: (String) -> Unit,
    ) {
        val authUri = Uri.parse(authorizationUrl)
        val customTabsIntent = CustomTabsIntent.Builder().build().apply {
            intent.addFlags(Intent.FLAG_ACTIVITY_NO_HISTORY)
        }

        try {
            customTabsIntent.launchUrl(activity, authUri)
            return
        } catch (_: ActivityNotFoundException) {
            // Fall through to the plain browser intent if custom tabs are unavailable.
        }

        val browserIntent = Intent(Intent.ACTION_VIEW, authUri).apply {
            addCategory(Intent.CATEGORY_BROWSABLE)
        }

        try {
            activity.startActivity(browserIntent)
        } catch (_: ActivityNotFoundException) {
            onLaunchFailure("No browser is available on this phone to complete Discord sign-in.")
        }
    }
}
