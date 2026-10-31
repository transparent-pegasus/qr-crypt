#!/usr/bin/env python3
"""Offline process boundary for the actual documented rebuild shell."""

import json
import os
from pathlib import Path
import sys

command = Path(sys.argv[0]).name
args = sys.argv[1:]
with Path(os.environ["RELEASE_REBUILD_TEST_CALLS"]).open("a") as calls:
    calls.write(json.dumps({
        "command": command,
        "args": args,
        "sourceSha": os.environ.get("QR_CRYPT_SOURCE_SHA"),
        "buildSha": os.environ.get("VITE_BUILD_SHA"),
    }) + "\n")

if command == "git" and args[:1] == ["-C"]:
    operation = args[2:]
    if operation == ["rev-parse", "HEAD"]:
        print(os.environ["RELEASE_REBUILD_TEST_HEAD"])
        sys.exit(0)
    if operation == ["status", "--porcelain", "--untracked-files=all"]:
        sys.exit(0)
if command == "mise":
    if args == ["install"]:
        sys.exit(0)
    if args[:2] == ["exec", "--"]:
        os.execvp(args[2], args[2:])
if command == "aube" and args in (["ci"], ["run", "build:prod"]):
    sys.exit(0)
sys.exit(f"fixture error: unexpected {command} invocation: {args}")
