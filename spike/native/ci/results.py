"""Collect chunked WebView console reports; feature failures remain data."""
import json
import re
import sys
import time
from pathlib import Path
from urllib.parse import unquote

CHECK_NAMES = [
    "secureContext", "webLocks", "zxing.prepare", "fixtures", "relay.render.sym", "relay.render.pq",
    "roundtrip.sym", "roundtrip.pq", "relay.playback.parse", "relay.playback.animate", "camera.api", "clipboard.api",
    "clipboard.auto.text", "clipboard.auto.image", "clipboard.gesture.text", "clipboard.gesture.image",
]


def validate(result):
    for field in ["origin", "href", "userAgent", "gestureMethod"]:
        assert isinstance(result[field], str) and result[field], "Missing report field: " + field
    assert isinstance(result["isSecureContext"], bool)
    assert [check["name"] for check in result["checks"]] == CHECK_NAMES, "Incomplete probe or harness error: " + json.dumps(result)
    for check in result["checks"]:
        assert isinstance(check["ok"], bool) and "detail" in check and isinstance(check["ms"], (int, float))
    return result


def extract(log):
    chunks = {}
    total = None
    for line in log.splitlines():
        match = re.search(r"G0R_RESULT (\d+)/(\d+) ([^\s]+)", line)
        if not match:
            continue
        index, count = int(match[1]), int(match[2])
        assert 1 <= index <= count <= 100, "Invalid report chunk numbering"
        if index == 1:
            chunks = {}
            total = count
        assert count == total, "Inconsistent report chunk count"
        chunks[index] = match[3]
        if len(chunks) == count:
            return validate(json.loads(unquote("".join(chunks[i] for i in range(1, count + 1)))))
    return None


def wait_for(predicate, seconds=180):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(0.25)
    raise TimeoutError("G0r harness timed out after " + str(seconds) + " s")


def read_log(path):
    return Path(path).read_text(errors="replace") if Path(path).exists() else ""


if __name__ == "__main__":
    if sys.argv[1] == "validate":
        result = validate(json.loads(Path(sys.argv[2]).read_text()))
    else:
        result = wait_for(lambda: extract(read_log(sys.argv[2])))
        Path(sys.argv[3]).write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))
