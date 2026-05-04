# Keep worker constructors available for WorkManager job recreation.
-keepclassmembers class * extends androidx.work.ListenableWorker {
    public <init>(android.content.Context, androidx.work.WorkerParameters);
}

# Preserve source information for release crash diagnostics.
-keepattributes SourceFile,LineNumberTable
