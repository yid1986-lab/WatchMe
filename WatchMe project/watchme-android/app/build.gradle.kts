import org.gradle.api.GradleException
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.gms.google-services")
}

val defaultDebugApiBaseUrl = "https://pro.watchme-bot.com"
val placeholderApiBaseUrl = "https://YOUR_PUBLIC_URL_HERE"

fun optionalStringProperty(name: String): String? {
    val projectValue = (project.findProperty(name) as String?)?.trim()?.takeIf { it.isNotEmpty() }
    val envValue = System.getenv(name)?.trim()?.takeIf { it.isNotEmpty() }
    return projectValue ?: envValue
}

fun normalizeBaseUrl(value: String): String = value.trim().trimEnd('/')

fun isReleaseTaskRequested(): Boolean {
    return gradle.startParameter.taskNames.any { taskName ->
        val normalizedTaskName = taskName.lowercase()
        "release" in normalizedTaskName || "bundle" in normalizedTaskName || "publish" in normalizedTaskName
    }
}

val sharedApiBaseUrl = optionalStringProperty("WATCHME_API_BASE_URL")
val debugApiBaseUrl = normalizeBaseUrl(
    optionalStringProperty("WATCHME_DEBUG_API_BASE_URL")
        ?: sharedApiBaseUrl
        ?: defaultDebugApiBaseUrl,
)
val releaseApiBaseUrl = optionalStringProperty("WATCHME_RELEASE_API_BASE_URL")
    ?: sharedApiBaseUrl
val releaseBuildRequested = isReleaseTaskRequested()

val keystoreProperties = Properties().apply {
    val keystorePropertiesFile = rootProject.file("keystore.properties")
    if (keystorePropertiesFile.exists()) {
        keystorePropertiesFile.inputStream().use(::load)
    }
}

fun optionalSigningProperty(name: String): String? {
    val keystoreValue = keystoreProperties.getProperty(name)?.trim()?.takeIf { it.isNotEmpty() }
    return keystoreValue ?: optionalStringProperty(name)
}

val releaseStoreFilePath = optionalSigningProperty("WATCHME_UPLOAD_STORE_FILE")
val releaseStoreFile = releaseStoreFilePath?.let { rootProject.file(it) }
val releaseStorePassword = optionalSigningProperty("WATCHME_UPLOAD_STORE_PASSWORD")
val releaseKeyAlias = optionalSigningProperty("WATCHME_UPLOAD_KEY_ALIAS")
val releaseKeyPassword = optionalSigningProperty("WATCHME_UPLOAD_KEY_PASSWORD")
val releaseSigningConfigured = releaseStoreFile?.exists() == true &&
    !releaseStorePassword.isNullOrBlank() &&
    !releaseKeyAlias.isNullOrBlank() &&
    !releaseKeyPassword.isNullOrBlank()

android {
    namespace = "com.watchme.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.watchme.app"
        minSdk = 26
        targetSdk = 34
        versionCode = 6
        versionName = "1.0.5"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        create("release") {
            if (releaseSigningConfigured) {
                storeFile = releaseStoreFile
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
                enableV1Signing = true
                enableV2Signing = true
                enableV3Signing = true
            }
        }
    }

    buildTypes {
        debug {
            buildConfigField("String", "API_BASE_URL", "\"$debugApiBaseUrl\"")
            buildConfigField(
                "boolean",
                "IS_API_BASE_URL_CONFIGURED",
                "true",
            )
            buildConfigField("boolean", "ALLOW_PREVIEW_TOKENS", "true")
        }
        release {
            val configuredReleaseApiBaseUrl = releaseApiBaseUrl?.let(::normalizeBaseUrl)
            if (releaseBuildRequested && configuredReleaseApiBaseUrl == null) {
                throw GradleException(
                    "Set WATCHME_RELEASE_API_BASE_URL or WATCHME_API_BASE_URL before building release.",
                )
            }
            if (releaseBuildRequested && !releaseSigningConfigured) {
                throw GradleException(
                    "Configure signing in keystore.properties or WATCHME_UPLOAD_* environment variables before building release.",
                )
            }
            isMinifyEnabled = true
            isShrinkResources = true
            if (releaseSigningConfigured) {
                signingConfig = signingConfigs.getByName("release")
            }
            buildConfigField(
                "String",
                "API_BASE_URL",
                "\"${configuredReleaseApiBaseUrl ?: placeholderApiBaseUrl}\"",
            )
            buildConfigField(
                "boolean",
                "IS_API_BASE_URL_CONFIGURED",
                (configuredReleaseApiBaseUrl != null).toString(),
            )
            buildConfigField("boolean", "ALLOW_PREVIEW_TOKENS", "false")
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2025.03.01")
    val firebaseBom = platform("com.google.firebase:firebase-bom:34.12.0")
    implementation(composeBom)
    implementation(firebaseBom)
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.activity:activity-compose:1.8.2")
    implementation("androidx.activity:activity-ktx:1.8.2")
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.7.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.7.0")
    implementation("androidx.lifecycle:lifecycle-service:2.7.0")
    implementation("androidx.work:work-runtime-ktx:2.9.0")
    implementation("androidx.browser:browser:1.7.0")
    implementation("io.coil-kt:coil-compose:2.6.0")
    implementation("com.google.firebase:firebase-messaging")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.7.3")
    testImplementation("org.json:json:20240303")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation(composeBom)
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test.ext:junit:1.1.5")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.1")
    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
