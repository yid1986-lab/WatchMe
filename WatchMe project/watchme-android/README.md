# WatchMe Android

## Debug build (USB debugging on)

1. Enable **Developer options** → **USB debugging** on the phone.
2. Connect USB; accept the RSA fingerprint on the device.
3. From this folder:

   ```bash
   ./gradlew installDebug
   ```

   Or open the project in Android Studio and **Run** the **debug** variant.

4. **API URL**: debug uses `https://pro.watchme-bot.com` by default. Override in `gradle.properties` or env:

   ```properties
   WATCHME_DEBUG_API_BASE_URL=https://pro.watchme-bot.com
   ```

   For a machine on your LAN (replace with your PC’s IP):

   ```properties
   WATCHME_DEBUG_API_BASE_URL=http://192.168.1.50:3101
   ```

   Use **HTTPS** for production-shaped TLS tests; plain HTTP needs a network security config (not included by default).

5. **Preview tokens** (`preview-pro` / `preview-lite`) work only in **debug** builds (`ALLOW_PREVIEW_TOKENS=true`). **Release** builds talk to the real API only.

## Backend requirements (live Pro)

Production API expects **`MOBILE_SESSION_SECRET`**, **`MOBILE_SESSION_REQUIRED=true`**, and related tokens on the server (see `pro.v2/.env.example`). If mobile routes return **401** after login, fix server env first, then `pm2 restart watchme-v2-api`.

## Release build

Set **`WATCHME_RELEASE_API_BASE_URL`** (or **`WATCHME_API_BASE_URL`**) and signing (`keystore.properties` or `WATCHME_UPLOAD_*`). Preview tokens are **off** in release.

```bash
./gradlew bundleRelease
```

## Version

Current **`versionName`**: see `app/build.gradle.kts` (`versionCode` / `versionName`).
