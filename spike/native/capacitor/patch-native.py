"""Add manual camera declarations and the iOS native-eval gesture harness."""
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
    app = plist.parent
    delegate = app / "AppDelegate.swift"
    text = delegate.read_text()
    assert "class G0rBridgeViewController:" not in text
    # Append to an existing build source instead of editing the generated Xcode project.
    delegate.write_text(text + "\n" + (root / "G0rBridgeViewController.swift").read_text())
    scene = app / "SceneDelegate.swift"
    text = scene.read_text()
    assert text.count("CAPBridgeViewController()") == 1
    scene.write_text(text.replace("CAPBridgeViewController()", "G0rBridgeViewController()"))
    storyboard = app / "Base.lproj/Main.storyboard"
    text = storyboard.read_text()
    marker = 'customClass="CAPBridgeViewController" customModule="Capacitor"'
    assert text.count(marker) == 1
    storyboard.write_text(text.replace(marker, 'customClass="G0rBridgeViewController" customModule="App" customModuleProvider="target"'))
