#!/bin/zsh
# Google TV's own home screen, on or off.
#   off: The Weekend is the only home, so Home opens it with no flash of Google's.
#   on:  back to how the Chromecast came (The Weekend still comes forward on Home).
# Needs this Mac connected over Wireless debugging (adb devices).
# If The Weekend ever breaks while Google's home is off: run "google-home.sh on".
set -e
G=com.google.android.apps.tv.launcherx
# Google's setup app keeps a blank backup home that takes over when Google's
# home is off, so it goes off too (a factory reset turns both back on).
SETUP=com.google.android.tungsten.setupwraith
case "$1" in
  off)
    adb shell pm disable-user --user 0 $G
    adb shell pm disable-user --user 0 $SETUP
    adb shell cmd package set-home-activity app.theweekend.tv/.MainActivity
    ;;
  on)
    adb shell pm enable $SETUP
    adb shell pm enable $G
    adb shell cmd package set-home-activity $G/.home.HomeActivity
    ;;
  *) echo "usage: google-home.sh on|off" >&2; exit 1 ;;
esac
adb shell pm list packages -d | grep -q $G && echo "Google TV home: off" || echo "Google TV home: on"
