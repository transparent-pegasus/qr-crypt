import hashlib
import os
import sys
from pathlib import Path

for argument in sys.argv[1:]:
    artifact = Path(argument)
    line = hashlib.sha256(artifact.read_bytes()).hexdigest() + "  " + artifact.name
    print(line)
    artifact.with_suffix(artifact.suffix + ".sha256").write_text(line + "\n")
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as summary:
            summary.write(line + "\n\n")
