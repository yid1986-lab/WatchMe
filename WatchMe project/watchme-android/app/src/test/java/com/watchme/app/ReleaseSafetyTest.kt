package com.watchme.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ReleaseSafetyTest {

    @Test
    fun previewTokensAreRejectedWhenReleaseGuardIsOff() {
        assertFalse(WatchMeApi.shouldTreatAsPreviewToken("preview-pro", allowPreviewTokens = false))
        assertFalse(WatchMeApi.shouldTreatAsPreviewToken("preview-lite", allowPreviewTokens = false))
        assertFalse(WatchMeApi.shouldTreatAsPreviewToken("real-session", allowPreviewTokens = false))
    }

    @Test
    fun previewTokensAreAcceptedOnlyWhenPreviewModeIsEnabled() {
        assertTrue(WatchMeApi.shouldTreatAsPreviewToken("preview-pro", allowPreviewTokens = true))
        assertTrue(WatchMeApi.shouldTreatAsPreviewToken("preview-lite", allowPreviewTokens = true))
        assertFalse(WatchMeApi.shouldTreatAsPreviewToken("real-session", allowPreviewTokens = true))
    }

    @Test
    fun pushRegistrationRequiresARealBackendInReleaseMode() {
        assertFalse(
            PushRegistration.canRegisterPush(
                sessionToken = "token",
                allowPreviewTokens = false,
                isApiBaseUrlConfigured = false,
            ),
        )
        assertTrue(
            PushRegistration.canRegisterPush(
                sessionToken = "token",
                allowPreviewTokens = false,
                isApiBaseUrlConfigured = true,
            ),
        )
        assertTrue(
            PushRegistration.canRegisterPush(
                sessionToken = "preview-pro",
                allowPreviewTokens = true,
                isApiBaseUrlConfigured = false,
            ),
        )
    }
}
