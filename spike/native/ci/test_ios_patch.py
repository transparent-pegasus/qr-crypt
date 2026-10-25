import plistlib
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CAPACITOR = ROOT / "capacitor"


class IosPatchTest(unittest.TestCase):
    def test_both_ios_entry_points_use_the_native_gesture_controller(self):
        (ROOT / "out").mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=ROOT / "out") as directory:
            root = Path(directory)
            shutil.copy(CAPACITOR / "patch-native.py", root)
            for source in CAPACITOR.glob("*.swift"):
                shutil.copy(source, root)
            app = root / "ios/App/App"
            (app / "Base.lproj").mkdir(parents=True)
            (app / "Info.plist").write_bytes(plistlib.dumps({"CFBundleIdentifier": "org.qrcrypt.g0r.spike"}))
            delegate = "import UIKit\nimport Capacitor\nclass AppDelegate: UIResponder, UIApplicationDelegate {}\n"
            (app / "AppDelegate.swift").write_text(delegate)
            (app / "SceneDelegate.swift").write_text("window?.rootViewController = CAPBridgeViewController()\n")
            storyboard = app / "Base.lproj/Main.storyboard"
            storyboard.write_text('<document><viewController customClass="CAPBridgeViewController" customModule="Capacitor"/></document>')

            subprocess.run([sys.executable, str(root / "patch-native.py"), "ios"], check=True)

            generated = (app / "AppDelegate.swift").read_text()
            self.assertTrue(generated.startswith(delegate), "The generated app delegate must be retained")
            controller = re.search(r"class (\w+): CAPBridgeViewController", generated)
            self.assertIsNotNone(controller, "The generated app needs a native gesture controller")
            name = controller[1]
            self.assertIn(name + "()", (app / "SceneDelegate.swift").read_text())
            view = ET.parse(storyboard).find("viewController")
            self.assertEqual(view.attrib["customClass"], name)
            self.assertEqual(view.attrib["customModuleProvider"], "target")
            self.assertNotEqual(view.attrib["customModule"], "Capacitor")
            info = plistlib.loads((app / "Info.plist").read_bytes())
            self.assertEqual(info["CFBundleIdentifier"], "org.qrcrypt.g0r.spike")
            self.assertIn("tap Start camera", info["NSCameraUsageDescription"])


if __name__ == "__main__":
    unittest.main()
