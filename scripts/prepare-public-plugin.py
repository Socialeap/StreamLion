"""Prepare a separate public-review candidate from an owned pilot source archive.

Usage: python3 scripts/prepare-public-plugin.py source.tar.gz output.zip
Does not upload, submit, change audience, or include reviewer credentials.
"""
import json
from pathlib import Path, PurePosixPath
import struct
import sys
import tarfile
import zipfile

source, destination = map(Path, sys.argv[1:3])
metadata = json.loads((Path(__file__).resolve().parents[1] / "docs/submission/public-metadata.json").read_text())
files = {}
with tarfile.open(source, "r:gz") as archive:
    for item in archive.getmembers():
        path = PurePosixPath(item.name)
        if path.is_absolute() or ".." in path.parts or item.issym() or item.islnk():
            raise ValueError("Unsafe archive member")
        if item.isfile():
            files[str(path)] = archive.extractfile(item).read()

manifest = json.loads(files["plugin.json"])
assert manifest["name"] == "gpt-11b52f5bcfe3bd414f9586be746198d8", "Wrong plugin identity"
manifest["version"] = "0.76.0"
manifest["description"] = "Google-owned spatial capture projects, exact room readings and reviewed updates in ChatGPT."
manifest["author"]["name"] = "Transcendence Media"
openai = manifest["extensions"]["com.openai"]
openai.pop("apps", None)
manifest.pop("apps", None)
openai["interface"].update(metadata["interface"])
openai["interface"]["longDescription"] = (
    "StreamLion helps spatial capture providers work from one selected Google workbook. "
    "Ask about a job, organize exact room measurements, review proposed project and checklist "
    "updates, and prepare client handovers alongside your conversation. Changes are saved "
    "only after you review and confirm them. The standalone StreamLion web app remains "
    "available for field work and offline drafts."
)
openai["review"] = metadata["review"]
openai["publication"] = metadata["publication"]
assert len(openai["interface"]["shortDescription"]) <= 30
assert len(openai["interface"]["defaultPrompt"]) <= 128
assert len(openai["review"]["test_cases"]["positive"]) == 5
assert len(openai["review"]["test_cases"]["negative"]) == 3
for path in [".app.json", ".mcp.json", "codex-mcp.json", ".codex-plugin/plugin.json"]:
    files.pop(path, None)
public_skills = Path(__file__).resolve().parents[1] / "docs/submission/skills"
for name in ["instructions", "setup"]:
    files[f"skills/{name}/SKILL.md"] = (public_skills / name / "SKILL.md").read_bytes()
files["plugin.json"] = (json.dumps(manifest, indent=2) + "\n").encode()
files["mcp.json"] = (json.dumps({
    "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
    "mcpServers": {"streamlion-ui": {
        "type": "streamable-http",
        "url": "https://streamlion.transcendencemedia.com/mcp-extension"
    }}
}, indent=2) + "\n").encode()
icon = files[openai["interface"]["logo"].removeprefix("./")]
assert icon[:8] == b"\x89PNG\r\n\x1a\n", "Icon must be PNG"
width, height = struct.unpack(">II", icon[16:24])
assert width == height and width >= 256 and len(icon) <= 5 * 1024 * 1024
destination.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as archive:
    for path, content in sorted(files.items()):
        archive.writestr(path, content)
with zipfile.ZipFile(destination) as archive:
    saved = json.loads(archive.read("plugin.json"))
    assert ".app.json" not in archive.namelist()
    assert "apps" not in saved and "apps" not in saved["extensions"]["com.openai"]
    assert archive.read("skills/setup/SKILL.md")
    for path in ["plugin.json", "skills/setup/SKILL.md", "skills/instructions/SKILL.md"]:
        content = archive.read(path).decode().lower()
        assert "pilot" not in content, f"Private pilot wording in {path}"
        assert "requires work" not in content, f"Private host restriction in {path}"
print(f"Prepared candidate: {destination}; {len(files)} files; icon {width}x{height}")
print("NOT READY TO SUBMIT: support URL deployment, demo recording, reviewer access, portal OAuth and business verification remain.")
