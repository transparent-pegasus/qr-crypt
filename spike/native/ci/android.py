import json
import re
import subprocess
from pathlib import Path
from results import extract, read_log, wait_for

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "out" / "capacitor-android"
OUT.mkdir(parents=True, exist_ok=True)
APP_ID = "org.qrcrypt.g0r.spike"
APK = ROOT / "capacitor/android/app/build/outputs/apk/debug/app-debug.apk"


def adb(*args, **kwargs):
    return subprocess.run(["adb", *args], check=True, timeout=60, **kwargs)


with (OUT / "device.txt").open("w") as log:
    adb("shell", "getprop", stdout=log)
    adb("shell", "dumpsys", "webviewupdate", stdout=log)
adb("install", "-r", str(APK))
adb("logcat", "-c")
with (OUT / "logcat.log").open("wb") as log:
    logger = subprocess.Popen(["adb", "logcat", "-v", "threadtime"], stdout=log, stderr=subprocess.STDOUT)
    try:
        adb("shell", "am", "start", "-W", "-n", APP_ID + "/.MainActivity")
        wait_for(lambda: "G0R_SIGNAL auto-done" in read_log(OUT / "logcat.log"))
        size = subprocess.check_output(["adb", "shell", "wm", "size"], text=True)
        width, height = map(int, re.findall(r"(\d+)x(\d+)", size)[-1])
        adb("shell", "input", "tap", str(width // 2), str(height // 2))
        result = wait_for(lambda: extract(read_log(OUT / "logcat.log")))
        (OUT / "result.json").write_text(json.dumps(result, indent=2))
        print(json.dumps(result, indent=2))
        (OUT / "native-clipboard.txt").write_text("SKIPPED: Android native clipboard verification, as required by the brief.\n")
    finally:
        with (OUT / "screenshot.png").open("wb") as screenshot:
            subprocess.run(["adb", "exec-out", "screencap", "-p"], stdout=screenshot, timeout=15)
        adb("shell", "am", "force-stop", APP_ID)
        logger.terminate()
        logger.wait(timeout=10)
