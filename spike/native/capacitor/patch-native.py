"""Add only the camera declarations needed by the manual probe."""
import plistlib
import sys
from pathlib import Path

root = Path(__file__).resolve().parent
if sys.argv[1] == "android":
    manifest = root / "android/app/src/main/AndroidManifest.xml"
    text = manifest.read_text()
    assert 'android.permission.CAMERA' not in text
    text = text.replace("</manifest>", '    <uses-permission android:name="android.permission.CAMERA" />\n</manifest>')
    manifest.write_text(text)
else:
    plist = root / "ios/App/App/Info.plist"
    info = plistlib.loads(plist.read_bytes())
    info["NSCameraUsageDescription"] = "Scan the G0r test QR after you tap Start camera."
    plist.write_bytes(plistlib.dumps(info))
