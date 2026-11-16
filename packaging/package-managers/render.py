#!/usr/bin/env python3
"""Render the Homebrew cask and Scoop manifest for a release.

usage: render.py <tag> <owner/repo> <assets-dir> <out-dir>

<assets-dir> holds the downloaded release files (Yggdrasil-*-mac-arm64.dmg, ...-mac-intel.dmg, ...-windows.zip).
Writes yggdrasil.rb (Homebrew cask) and yggdrasil.json (Scoop) with the real URLs and SHA-256 sums.
A platform whose file is missing is left out, so a partial release still produces a valid manifest.
"""
import glob, hashlib, json, os, sys

tag, repo, assets, out = sys.argv[1:5]
version = tag.lstrip("v")
base = f"https://github.com/{repo}/releases/download/{tag}"


def find(pattern):
    hits = sorted(glob.glob(os.path.join(assets, pattern)))
    if not hits:
        return None
    path = hits[-1]
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    name = os.path.basename(path)
    return {"url": f"{base}/{name}", "sha256": h.hexdigest()}


arm = find("Yggdrasil-*-mac-arm64.dmg")
intel = find("Yggdrasil-*-mac-intel.dmg")
win = find("Yggdrasil-*-windows.zip")
os.makedirs(out, exist_ok=True)

if arm or intel:
    blocks = []
    for key, a in (("arm", arm), ("intel", intel)):
        if a:
            blocks.append(f'  on_{key} do\n    sha256 "{a["sha256"]}"\n    url "{a["url"]}"\n  end\n')
    cask = f'''cask "yggdrasil" do
  version "{version}"

{chr(10).join(blocks)}
  name "Yggdrasil"
  desc "Self-hosted research app: read arXiv papers, notes, LaTeX, slides"
  homepage "https://github.com/{repo}"

  livecheck do
    url :url
    strategy :github_latest
  end

  # The app is not code-signed; drop the quarantine flag so it opens without the Gatekeeper dialog.
  app "Yggdrasil.app"
  postflight do
    system_command "/usr/bin/xattr", args: ["-dr", "com.apple.quarantine", "#{{appdir}}/Yggdrasil.app"]
  end
end
'''
    open(os.path.join(out, "yggdrasil.rb"), "w").write(cask)

if win:
    scoop = {
        "version": version,
        "description": "Self-hosted research app: read arXiv papers, notes, LaTeX, slides",
        "homepage": f"https://github.com/{repo}",
        "license": "MIT",
        "architecture": {"64bit": {"url": win["url"], "hash": win["sha256"]}},
        "extract_dir": "Yggdrasil-windows",
        "shortcuts": [["Yggdrasil.bat", "Yggdrasil"]],
        "checkver": "github",
    }
    with open(os.path.join(out, "yggdrasil.json"), "w") as f:
        json.dump(scoop, f, indent=2)
        f.write("\n")

print("rendered:", ", ".join(sorted(os.listdir(out))) or "nothing")
