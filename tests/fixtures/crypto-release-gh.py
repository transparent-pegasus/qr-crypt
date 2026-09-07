#!/usr/bin/env python3
"""Offline gh API fixture. Honor gh's JSON extraction before returning output."""

import json
import os
from pathlib import Path
import subprocess
import sys

args = sys.argv[1:]
with Path(os.environ["CRYPTO_TEST_GH_CALLS"]).open("a") as calls:
    calls.write(json.dumps(args) + "\n")

endpoint = "repos/paulmillr/noble-post-quantum/releases/latest"
if not args or args[0] != "api" or not any(
    arg.lstrip("/") == endpoint or arg == "https://api.github.com/" + endpoint
    for arg in args
):
    sys.exit("Fixture only permits the official latest-release GET endpoint")
if ("--method" in args or "-X" in args) and "GET" not in args:
    sys.exit("Fixture only permits GET")

status = int(os.environ.get("CRYPTO_TEST_GH_STATUS", "0"))
if status:
    sys.stderr.write("fixture: GitHub is unreachable\n")
    sys.exit(status)

body = Path(os.environ["CRYPTO_TEST_GH_RESPONSE"]).read_text()
expression = None
for index, arg in enumerate(args):
    if arg in ("--jq", "-q"):
        expression = args[index + 1]
    elif arg.startswith("--jq=") or arg.startswith("-q="):
        expression = arg.split("=", 1)[1]

if expression is None:
    sys.stdout.write(body)
else:
    result = subprocess.run(["jq", "-r", expression], input=body, text=True)
    sys.exit(result.returncode)
