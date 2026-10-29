#!/usr/bin/env python3
"""Offline official release GETs, including gh's real jq field extraction."""

import json
import os
from pathlib import Path
import subprocess
import sys

args = sys.argv[1:]
with Path(os.environ["ASSESSED_RELEASE_TEST_CALLS"]).open("a") as calls:
    calls.write(json.dumps(args) + "\n")

scenario = json.loads(Path(os.environ["ASSESSED_RELEASE_TEST_SCENARIO"]).read_text())
endpoints = {
    "repos/paulmillr/noble-post-quantum/releases/latest",
    "repos/Sec-ant/zxing-wasm/releases/latest",
}
matches = [
    endpoint for endpoint in endpoints
    if any(arg.lstrip("/") == endpoint or arg == "https://api.github.com/" + endpoint
           for arg in args)
]
if not args or args[0] != "api" or len(matches) != 1:
    sys.exit("Fixture only permits the two official latest-release GET endpoints")
if "--hostname" in args and args[args.index("--hostname") + 1] != "github.com":
    sys.exit("Fixture only permits github.com")
if ("--method" in args or "-X" in args) and "GET" not in args:
    sys.exit("Fixture only permits GET")

response = scenario[matches[0]]
if response["status"]:
    sys.stderr.write("fixture: GitHub is unreachable\n")
    sys.exit(response["status"])

expression = None
for index, arg in enumerate(args):
    if arg in ("--jq", "-q"):
        expression = args[index + 1]
    elif arg.startswith("--jq=") or arg.startswith("-q="):
        expression = arg.split("=", 1)[1]

if expression is None:
    sys.stdout.write(response["body"])
else:
    result = subprocess.run(["jq", "-r", expression], input=response["body"], text=True)
    sys.exit(result.returncode)
