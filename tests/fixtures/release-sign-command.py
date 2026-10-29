#!/usr/bin/env python3
"""Record the external Cosign boundary without signing or network access."""

import json
import os
from pathlib import Path
import sys

args = sys.argv[1:]
with Path(os.environ["RELEASE_SIGN_TEST_CALLS"]).open("a") as calls:
    calls.write(json.dumps(args) + "\n")
if not args or args[0] not in ("sign-blob", "verify-blob"):
    sys.exit("fixture error: unexpected Cosign operation")
if not Path(args[1]).is_file():
    sys.exit("fixture error: missing archive")
bundle = Path(args[args.index("--bundle") + 1])
if args[0] == "sign-blob":
    bundle.write_text('{"fixture":"offline signature boundary"}\n')
elif not bundle.is_file():
    sys.exit("fixture error: missing signature bundle")
