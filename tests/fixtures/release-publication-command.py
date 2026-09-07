#!/usr/bin/env python3
"""Offline gh/docker boundary: service records and byte transport, no release policy."""

import json
import os
from pathlib import Path
import shutil
import sys

root = Path(os.environ["RELEASE_PUBLICATION_FIXTURE"])
scenario = json.loads((root / "scenario.json").read_text())
state_path = root / "state.json"
state = json.loads(state_path.read_text())
command = Path(sys.argv[0]).name
args = sys.argv[1:]
with (root / "calls.jsonl").open("a") as log:
    log.write(json.dumps({"command": command, "args": args}) + "\n")


def error(message):
    print(message, file=sys.stderr)
    sys.exit(1)


def fail_if_requested(operation):
    message = scenario.get("errors", {}).get(operation)
    if message:
        error(message)


def option(name, default=None):
    return args[args.index(name) + 1] if name in args else default


def respond(value):
    print(json.dumps(value))
    sys.exit(0)


def save():
    state_path.write_text(json.dumps(state))


if command == "docker":
    if args[:2] != ["run", "--rm"] or "verify-blob" not in args:
        error("fixture error: unexpected docker command")
    fail_if_requested("docker")
    sys.exit(0)

if command != "gh":
    error("fixture error: unknown command")

if args[0] == "api":
    endpoint = next(arg for arg in args if arg.startswith("repos/"))
    endpoint = endpoint.removeprefix("repos/fixture/repository/")
    method = option("--method", "GET")
    if method == "GET":
        if endpoint.startswith("actions/artifacts/"):
            artifact = {"101": "package.zip", "202": "signature.zip"}[endpoint.split("/")[2]]
            sys.stdout.buffer.write((root / "handoffs" / artifact).read_bytes())
            sys.exit(0)
        if endpoint.startswith("git/ref/tags/"):
            if state["tag"] is None:
                error("gh: Not Found (HTTP 404)")
            respond({"object": state["tag"]})
        if endpoint in ("releases", "releases?per_page=100"):
            releases = [state["release"]] if state["release"] else []
            respond([[], releases] if "--slurp" in args else releases)
        if endpoint.startswith("releases/"):
            fail_if_requested("draft-read")
            release = state["release"]
            if release is None or endpoint != f"releases/{release['id']}":
                error("gh: Not Found (HTTP 404)")
            respond({**release, **scenario.get("readOverride", {})})
    if method == "POST" and endpoint == "git/refs":
        fields = dict(arg.split("=", 1) for arg in args if arg.startswith(("ref=", "sha=")))
        state["tag"] = {"type": "commit", "sha": fields["sha"]}
        save()
        respond({"object": state["tag"]})
    if method == "POST" and endpoint == "releases":
        fail_if_requested("create")
        if scenario.get("createRace"):
            state["release"] = scenario["createRace"]
            save()
            error("gh: Validation Failed (HTTP 422)")
        if state["release"]:
            error("gh: Validation Failed (HTTP 422)")
        payload = json.loads(Path(option("--input")).read_text())
        state["release"] = {
            **payload,
            "id": 73,
            "author": {"login": "github-actions[bot]"},
            "assets": [],
            "immutable": False,
        }
        save()
        respond(state["release"])
    if method == "PATCH" and endpoint == f"releases/{state['release']['id']}":
        payload = json.loads(Path(option("--input")).read_text())
        state["release"].update(payload)
        if payload.get("draft") is False:
            state["release"]["immutable"] = True
        save()
        respond(state["release"])

if args[:2] == ["release", "view"]:
    fail_if_requested("view")
    release = state["release"]
    if release is None:
        error("release not found")
    # gh's camelCase projection is deliberately distinct from REST metadata.
    fields = {
        "databaseId": release["id"],
        "id": "RE_fixture_node_id",
        "tagName": release["tag_name"],
        "isDraft": release["draft"],
        "isPrerelease": release["prerelease"],
        "isImmutable": release["immutable"],
        "name": release["name"],
        "body": release["body"],
        "assets": release["assets"],
        "author": release["author"],
    }
    respond({field: fields[field] for field in option("--json").split(",")})

if args[:2] == ["release", "upload"]:
    fail_if_requested("upload")
    for arg in args[3:]:
        file = Path(arg.split("#", 1)[0])
        if file.is_file():
            destination = root / "remote-assets" / file.name
            if destination.exists() and "--clobber" not in args:
                error("gh: asset already exists")
            shutil.copyfile(file, destination)
            state["release"]["assets"] = [
                asset for asset in state["release"]["assets"] if asset["name"] != file.name
            ] + [{"name": file.name, "state": "uploaded"}]
    save()
    sys.exit(0)

if args[:2] == ["release", "download"]:
    destination = Path(option("--dir"))
    for asset in state["release"]["assets"]:
        shutil.copyfile(root / "remote-assets" / asset["name"], destination / asset["name"])
    if scenario.get("corruptDownload"):
        (destination / scenario["corruptDownload"]).write_bytes(b"corrupted download\n")
    sys.exit(0)

if args[:2] in (["release", "verify"], ["release", "verify-asset"]):
    fail_if_requested("attestation")
    sys.exit(0)

error(f"fixture error: unexpected gh command: {args}")
