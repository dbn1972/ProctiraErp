plugins {
    id("com.android.application")
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "org.openemis.openemis_mobile"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        // flutter_local_notifications (v10+) requires core library desugaring
        // on the consuming app, even when scheduled notifications are unused.
        isCoreLibraryDesugaringEnabled = true
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_17.toString()
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "org.openemis.openemis_mobile"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        // PRC-M470: a real release signing config is loaded from
        // key.properties (storeFile/storePassword/keyAlias/keyPassword) or the
        // matching ANDROID_KEYSTORE_* environment variables. If none are
        // present the release build fails closed below instead of silently
        // shipping debug-signed artifacts.
        create("release") {
            val keystoreProperties = java.util.Properties()
            val keystoreFile = rootProject.file("key.properties")
            if (keystoreFile.exists()) {
                keystoreProperties.load(keystoreFile.inputStream())
            }
            val storePath = keystoreProperties.getProperty("storeFile")
                ?: System.getenv("ANDROID_KEYSTORE_FILE")
            if (storePath != null) {
                storeFile = file(storePath)
                storePassword = keystoreProperties.getProperty("storePassword")
                    ?: System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                    ?: System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = keystoreProperties.getProperty("keyPassword")
                    ?: System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            val releaseSigning = signingConfigs.getByName("release")
            if (releaseSigning.storeFile != null) {
                // Properly configured release keystore.
                signingConfig = releaseSigning
            } else if (System.getenv("ALLOW_DEBUG_SIGNED_RELEASE") == "1") {
                // Explicit local opt-in for `flutter run --release` smoke tests.
                signingConfig = signingConfigs.getByName("debug")
            }
            // PRC-M470: when neither a real keystore nor the explicit debug
            // opt-in is present we must fail closed — but ONLY for release
            // builds. The check is deferred to the release task's execution
            // phase (doFirst, below) instead of running here in the
            // configuration phase. AGP configures EVERY build type while
            // building any variant's model, so throwing here broke
            // `assembleDebug` / `flutter run` (debug) when no keystore existed.
        }
    }

    // PRC-M470: enforce the release-signing contract at execution time, scoped
    // to release-assembling tasks only. Debug builds never reach this block.
    tasks.matching { task ->
        val name = task.name
        name.startsWith("assemble") && name.contains("Release") ||
            name.startsWith("bundle") && name.contains("Release") ||
            name.startsWith("package") && name.contains("Release")
    }.configureEach {
        doFirst {
            val releaseSigning = signingConfigs.getByName("release")
            val allowDebugSigned = System.getenv("ALLOW_DEBUG_SIGNED_RELEASE") == "1"
            if (releaseSigning.storeFile == null && !allowDebugSigned) {
                throw org.gradle.api.GradleException(
                    "Release build has no signing config. Provide key.properties " +
                        "or ANDROID_KEYSTORE_* env, or set ALLOW_DEBUG_SIGNED_RELEASE=1 " +
                        "for a local debug-signed smoke build.",
                )
            }
        }
    }
}

flutter {
    source = "../.."
}

dependencies {
    // Version from the flutter_local_notifications 22.x Android setup guide.
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")
}
