pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolution {
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "EDxoVoice"
include(":app")     // Wear OS watch app
include(":mobile")  // Phone companion app
