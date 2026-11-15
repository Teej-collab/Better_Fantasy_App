#!/usr/bin/env python3
"""Writes app/src/main/baseline-prof.txt listing every class and method in the
release build, so Android compiles the whole app ahead of time.

The Chromecast only compiles what a profile lists (a full compile request falls
back to that), and the profile's wildcard rules don't survive R8. Run after
adding code or libraries: ./gradlew assembleRelease && scripts/gen-profile.py
&& ./gradlew assembleRelease
"""
import glob, os, re, subprocess, sys, tempfile, zipfile

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
apk = os.path.join(root, "app/build/outputs/apk/release/app-release.apk")
dexdump = sorted(glob.glob("/opt/homebrew/share/android-commandlinetools/build-tools/*/dexdump"))[-1]
KEEP = ("Lapp/theweekend/", "Landroidx/", "Lkotlin/", "Lkotlinx/")

out = []
with tempfile.TemporaryDirectory() as tmp, zipfile.ZipFile(apk) as z:
    for name in z.namelist():
        if not re.fullmatch(r"classes\d*\.dex", name):
            continue
        path = z.extract(name, tmp)
        dump = subprocess.run([dexdump, path], capture_output=True, text=True, check=True).stdout
        cls = None
        method = None
        for line in dump.splitlines():
            line = line.strip()
            if line.startswith("Class descriptor"):
                cls = line.split("'")[1]
                if cls.startswith(KEEP):
                    out.append(cls)
            elif line.startswith("name") and cls and cls.startswith(KEEP):
                method = line.split("'")[1]
            elif line.startswith("type") and method and cls.startswith(KEEP):
                sig = line.split("'")[1]
                if sig.startswith("("):
                    out.append(f"HSP{cls}->{method}{sig}")
                method = None

dest = os.path.join(root, "app/src/main/baseline-prof.txt")
with open(dest, "w") as f:
    f.write("\n".join(sorted(set(out))) + "\n")
print(f"{len(out)} rules -> {dest}")
