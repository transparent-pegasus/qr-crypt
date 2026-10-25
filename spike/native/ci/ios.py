import json
import subprocess
from pathlib import Path
from results import extract, read_log, wait_for

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "out" / "capacitor-ios"
OUT.mkdir(parents=True, exist_ok=True)
APP_ID = "org.qrcrypt.g0r.spike"


def simctl(*args, **kwargs):
    return subprocess.run(["xcrun", "simctl", *args], check=True, timeout=120, **kwargs)


devices = json.loads(subprocess.check_output(["xcrun", "simctl", "list", "devices", "available", "--json"]))
(OUT / "devices.json").write_text(json.dumps(devices, indent=2))
choices = [(runtime, device) for runtime, entries in devices["devices"].items() if "iOS" in runtime for device in entries if device.get("isAvailable") and "iPhone" in device["name"]]
assert choices, "No available iPhone simulator runtime on the runner"
runtime, device = sorted(choices, key=lambda item: item[0], reverse=True)[0]
udid = device["udid"]
if device["state"] != "Booted":
    simctl("boot", udid)
simctl("bootstatus", udid, "-b")
subprocess.run(["open", "-a", "Simulator", "--args", "-CurrentDeviceUDID", udid], check=True)
simctl("install", udid, str(ROOT / "capacitor/ios/build/Build/Products/Debug-iphonesimulator/App.app"))
with (OUT / "console.log").open("wb") as log:
    process = subprocess.Popen(["xcrun", "simctl", "launch", "--console-pty", udid, APP_ID], stdout=log, stderr=subprocess.STDOUT)
    try:
        # shortcut: no inexpensive simulator tap route, owner verifies a real tap on iOS hardware later.
        result = wait_for(lambda: extract(read_log(OUT / "console.log")))
        (OUT / "result.json").write_text(json.dumps(result, indent=2))
        print(json.dumps(result, indent=2))
        with (OUT / "native-clipboard.txt").open("wb") as clipboard:
            for command in ["pbinfo", "pbpaste"]:
                clipboard.write(("simctl " + command + " booted\n").encode())
                clipboard.flush()
                subprocess.run(["xcrun", "simctl", command, "booted"], stdout=clipboard, stderr=subprocess.STDOUT, timeout=15)
    finally:
        subprocess.run(["xcrun", "simctl", "io", udid, "screenshot", str(OUT / "screenshot.png")], timeout=15)
        subprocess.run(["xcrun", "simctl", "terminate", udid, APP_ID], timeout=15)
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
