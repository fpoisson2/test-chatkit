plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.edxo.voice"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.edxo.voice"
        minSdk = 30
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"

        // Set your backend URL here
        buildConfigField("String", "BACKEND_WS_URL", "\"wss://chatkit.ve2fpd.com/api/voice-relay/ws\"")
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.wear:wear:1.3.0")
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.json:json:20231013")
}
