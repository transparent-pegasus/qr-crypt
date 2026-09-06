import os
import stat
import zipfile
from datetime import datetime, timezone
from pathlib import Path

parent = Path(os.environ["ZIP_STAGING_PARENT"])
root_name = os.environ["ZIP_ROOT"]
root = parent / root_name
output = Path(os.environ["ZIP_OUTPUT"])
timestamp = datetime.fromtimestamp(
    int(os.environ["COMMIT_EPOCH"]),
    tz=timezone.utc,
).timetuple()[:6]

files = sorted(path for path in root.rglob("*") if path.is_file())
if not files:
    raise SystemExit("staging tree has no regular files")

with zipfile.ZipFile(
    output,
    mode="x",
    compression=zipfile.ZIP_STORED,
) as archive:
    for path in files:
        mode = path.lstat().st_mode
        if stat.S_IFMT(mode) != stat.S_IFREG:
            raise SystemExit(f"unsafe staging entry: {path}")
        relative = path.relative_to(parent).as_posix()
        info = zipfile.ZipInfo(relative, date_time=timestamp)
        info.create_system = 3
        info.compress_type = zipfile.ZIP_STORED
        info.external_attr = (stat.S_IFREG | 0o644) << 16
        with path.open("rb") as source:
            archive.writestr(info, source.read())
