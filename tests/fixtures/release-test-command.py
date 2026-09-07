#!/usr/bin/env python3
"""Local process fixtures for release orchestration; browser behavior has E2E coverage."""

import json
import os
from pathlib import Path
import sys
from urllib.parse import urlsplit

command = Path(sys.argv[0]).name
args = sys.argv[1:]
root = Path(os.environ["RELEASE_TEST_ROOT"])
with Path(os.environ["RELEASE_TEST_CALLS"]).open("a") as calls:
    calls.write(json.dumps({
        "command": command,
        "args": args,
        "artifactRoot": os.environ.get("E2E_ARTIFACT_ROOT"),
    }) + "\n")

if command == "aube":
    if args[:2] == ["run", "serve:dist"]:
        sys.exit(0)
    if args[:2] != ["run", "test:e2e"]:
        sys.exit("Unexpected package command in release test fixture")
    mutation = json.loads(os.environ.get("RELEASE_TEST_MUTATION", "null"))
    if mutation:
        target = Path(mutation["path"])
        if mutation.get("remove"):
            target.unlink()
        else:
            with target.open("ab") as output:
                output.write(b"changed during browser tests\n")
    sys.exit(int(os.environ.get("RELEASE_TEST_BROWSER_STATUS", "0")))

if command != "curl":
    sys.exit("Unknown release fixture command")

# Supply reference-server HTTP results without binding the baseline's fixed
# port or making any network request. These are fixtures, not browser evidence.
url = next(arg for arg in args if arg.startswith("http://127.0.0.1:"))
pathname = urlsplit(url).path
candidate = root / pathname.lstrip("/")
filename = candidate if candidate.is_file() else root / "index.html"
content_type = (
    "application/manifest+json" if pathname == "/manifest.webmanifest"
    else "text/plain" if pathname.endswith(".txt")
    else "text/html"
)
headers = (
    "HTTP/1.1 200 OK\r\n"
    "Content-Security-Policy: default-src 'self'; connect-src 'self'; "
    "object-src 'none'; script-src 'self' 'wasm-unsafe-eval'\r\n"
    "Cache-Control: no-store\r\n"
    f"Content-Type: {content_type}\r\n\r\n"
)

def option(*names):
    for index, arg in enumerate(args):
        if arg in names:
            return args[index + 1]
    return None

header_file = option("--dump-header", "-D")
if header_file:
    Path(header_file).write_text(headers)
output_file = option("--output", "-o")
if output_file:
    Path(output_file).write_bytes(filename.read_bytes())
else:
    sys.stdout.buffer.write(filename.read_bytes())
