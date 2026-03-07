plugins {
    id("com.android.application") version "9.1.0" apply false
}

// Build both APKs with: ./gradlew buildAll
// Output: build/outputs/apk/ (phone + watch)
tasks.register("buildAll") {
    description = "Build both phone and watch APKs"
    dependsOn(":mobile:assembleDebug", ":app:assembleDebug")

    doLast {
        val outDir = file("build/outputs/apk")
        outDir.mkdirs()

        val phoneApk = file("mobile/build/outputs/apk/debug/mobile-debug.apk")
        val watchApk = file("app/build/outputs/apk/debug/app-debug.apk")

        if (phoneApk.exists()) phoneApk.copyTo(file("$outDir/edxo-phone.apk"), overwrite = true)
        if (watchApk.exists()) watchApk.copyTo(file("$outDir/edxo-watch.apk"), overwrite = true)

        println("APKs built:")
        if (phoneApk.exists()) println("  Phone: $outDir/edxo-phone.apk")
        if (watchApk.exists()) println("  Watch: $outDir/edxo-watch.apk")
    }
}

tasks.register("buildAllRelease") {
    description = "Build both phone and watch release APKs"
    dependsOn(":mobile:assembleRelease", ":app:assembleRelease")

    doLast {
        val outDir = file("build/outputs/apk")
        outDir.mkdirs()

        val phoneApk = file("mobile/build/outputs/apk/release/mobile-release-unsigned.apk")
        val watchApk = file("app/build/outputs/apk/release/app-release-unsigned.apk")

        if (phoneApk.exists()) phoneApk.copyTo(file("$outDir/edxo-phone-release.apk"), overwrite = true)
        if (watchApk.exists()) watchApk.copyTo(file("$outDir/edxo-watch-release.apk"), overwrite = true)

        println("Release APKs built:")
        if (phoneApk.exists()) println("  Phone: $outDir/edxo-phone-release.apk")
        if (watchApk.exists()) println("  Watch: $outDir/edxo-watch-release.apk")
    }
}
