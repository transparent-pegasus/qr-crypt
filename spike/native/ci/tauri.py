import json
import os
import platform
import subprocess
from pathlib import Path
from results import validate, wait_for

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "out" / ("tauri-" + platform.system().lower())
OUT.mkdir(parents=True, exist_ok=True)
SYSTEM = platform.system()


def evidence(args, filename):
    try:
        result = subprocess.run(args, capture_output=True, timeout=15)
        (OUT / filename).write_bytes(result.stdout + result.stderr)
        print(filename + ": " + result.stdout.decode(errors="replace") + result.stderr.decode(errors="replace"))
    except Exception as error:
        (OUT / filename).write_text(str(error))


binary = ROOT / "tauri" / "target" / "debug" / ("g0r-spike.exe" if SYSTEM == "Windows" else "g0r-spike")
env = dict(os.environ, G0R_OUT_DIR=str(OUT))
if SYSTEM == "Darwin":
    env["G0R_GESTURE"] = "eval"
with (OUT / "app.log").open("wb") as log:
    process = subprocess.Popen([str(binary)], stdout=log, stderr=subprocess.STDOUT, env=env)
    def has_file(name):
        if (OUT / name).exists():
            return True
        if process.poll() is not None:
            raise RuntimeError("Tauri exited before " + name)
        return False
    try:
        wait_for(lambda: has_file("auto-done"))
        if SYSTEM == "Linux":
            window = subprocess.check_output(["xdotool", "search", "--sync", "--name", "G0r Spike"], text=True, timeout=10).splitlines()[-1]
            geometry = subprocess.check_output(["xdotool", "getwindowgeometry", "--shell", window], text=True)
            dims = dict(line.split("=", 1) for line in geometry.splitlines())
            subprocess.run(["xdotool", "windowfocus", "--sync", window], check=True)
            subprocess.run(["xdotool", "mousemove", "--window", window, str(int(dims["WIDTH"]) // 2), str(int(dims["HEIGHT"]) // 2), "click", "1"], check=True)
        elif SYSTEM == "Windows":
            subprocess.run(["powershell", "-NoProfile", "-STA", "-File", str(ROOT / "ci" / "windows.ps1"), "-Mode", "Click", "-AppPid", str(process.pid), "-OutDir", str(OUT)], check=True)
        wait_for(lambda: has_file("result.json"))
        result = validate(json.loads((OUT / "result.json").read_text()))
        print(json.dumps(result, indent=2))
        if SYSTEM == "Linux":
            evidence(["xclip", "-selection", "clipboard", "-t", "TARGETS", "-o"], "native-clipboard.txt")
            evidence(["import", "-window", "root", str(OUT / "screenshot.png")], "screenshot.log")
        elif SYSTEM == "Darwin":
            evidence(["osascript", "-e", "clipboard info"], "native-clipboard.txt")
            evidence(["screencapture", "-x", str(OUT / "screenshot.png")], "screenshot.log")
        else:
            evidence(["powershell", "-NoProfile", "-STA", "-File", str(ROOT / "ci" / "windows.ps1"), "-Mode", "Evidence", "-AppPid", str(process.pid), "-OutDir", str(OUT)], "native-clipboard.txt")
    finally:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
