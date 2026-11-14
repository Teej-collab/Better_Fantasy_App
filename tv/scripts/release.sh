#!/bin/zsh
# Publish a TV build: the TV's Settings → Updates finds it and installs it.
#   1. bump versionCode (and versionName) in app/build.gradle.kts
#   2. tv/scripts/release.sh "What changed, in a line or two"
# Same key every time (this Mac's ~/.android/debug.keystore): back it up —
# a build signed with a different key can't update the one on the TV.
set -e
cd "${0:A:h}/.."
export JAVA_HOME=/opt/homebrew/opt/openjdk@17
code=$(grep -E '^\s*versionCode = ' app/build.gradle.kts | grep -oE '[0-9]+')
name=$(grep -E '^\s*versionName = ' app/build.gradle.kts | grep -oE '"[^"]+"' | tr -d '"')
if gh release view "tv-v$code" >/dev/null 2>&1; then
  echo "tv-v$code already exists: bump versionCode first." >&2
  exit 1
fi
./gradlew assembleRelease -q
cp app/build/outputs/apk/release/app-release.apk "/tmp/the-weekend-tv-$name.apk"
gh release create "tv-v$code" "/tmp/the-weekend-tv-$name.apk" \
  --title "The Weekend TV $name" \
  --notes "${1:-Updates to The Weekend TV.}"
echo "Published tv-v$code ($name). On the TV: Settings → Updates."
