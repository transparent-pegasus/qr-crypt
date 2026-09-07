"""Bind the complete extracted tree to one previously captured ZIP digest."""

import hashlib
import io
import re
import stat
import sys
import zipfile
from pathlib import Path, PurePosixPath


def fail(message):
    raise SystemExit(f"tested archive error: {message}")


archive_path, document_root = map(Path, sys.argv[1:3])
expected_digest = sys.argv[3]
if not re.fullmatch(r"[0-9a-f]{64}", expected_digest):
    fail("invalid expected SHA-256")
if not document_root.is_absolute() or not document_root.is_dir():
    fail("document root must be an existing absolute directory")
if document_root.is_symlink() or archive_path.is_symlink():
    fail("release inputs must not be symlinks")

# Read once, so the member comparison consumes the bytes whose digest passed.
archive_bytes = archive_path.read_bytes()
if hashlib.sha256(archive_bytes).hexdigest() != expected_digest:
    fail("ZIP SHA-256 changed")

expected_files = set()
expected_dirs = set()
with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
    for member in archive.infolist():
        name = member.filename
        path = PurePosixPath(name)
        if (
            not re.fullmatch(r"[A-Za-z0-9._/-]+", name)
            or path.is_absolute()
            or ".." in path.parts
            or name != path.as_posix()
            or len(path.parts) < 2
            or path.parts[0] != archive_path.stem
            or stat.S_IFMT(member.external_attr >> 16) != stat.S_IFREG
        ):
            fail("ZIP contains an unsafe or non-regular member")
        relative = path.relative_to(archive_path.stem)
        if relative in expected_files:
            fail("ZIP contains a duplicate member")
        expected_files.add(relative)
        expected_dirs.update(relative.parents)
        extracted = document_root / relative
        if not extracted.is_file() or extracted.is_symlink():
            fail(f"missing or non-regular extracted member: {relative}")
        if extracted.read_bytes() != archive.read(member):
            fail(f"extracted member differs from ZIP: {relative}")

if not expected_files:
    fail("ZIP is empty")
expected_dirs.discard(PurePosixPath("."))
actual_files = set()
actual_dirs = set()
for path in document_root.rglob("*"):
    relative = PurePosixPath(path.relative_to(document_root).as_posix())
    mode = path.lstat().st_mode
    if stat.S_ISREG(mode):
        actual_files.add(relative)
    elif stat.S_ISDIR(mode):
        actual_dirs.add(relative)
    else:
        fail("extracted tree contains a symlink or special file")
if actual_files != expected_files or actual_dirs != expected_dirs:
    fail("extracted tree does not exactly match the ZIP member set")

print(f"Verified ZIP {expected_digest} and all {len(expected_files)} extracted members")
