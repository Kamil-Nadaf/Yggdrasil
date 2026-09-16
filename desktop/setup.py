"""One-time desktop install: TinyTeX, Node, Feynman CLI. No Docker, no sudo."""
from __future__ import annotations

import os
import platform
import shutil
import subprocess
import tarfile
import urllib.request
from collections.abc import Callable
from pathlib import Path

NODE_VERSION = "v22.22.2"
FEYNMAN_PKG = "@advaitpaliwal/feynman@0.3.48"
TINYTEX_INSTALL = "https://yihui.org/tinytex/install-bin-unix.sh"

Progress = Callable[[str], None]


def support_dir() -> Path:
    if platform.system() == "Darwin":
        return Path.home() / "Library" / "Application Support" / "Yggdrasil"
    if platform.system() == "Windows":
        return Path(os.environ.get("APPDATA", Path.home())) / "Yggdrasil"
    return Path.home() / ".local" / "share" / "Yggdrasil"


def runtime_dir() -> Path:
    path = support_dir() / "runtime"
    path.mkdir(parents=True, exist_ok=True)
    return path


def marker_path() -> Path:
    return support_dir() / "setup-complete.json"


def tex_bin_dir() -> Path | None:
    roots = [
        Path("/Library/TeX/texbin"),
        Path.home() / "Library" / "TinyTeX" / "bin",
        Path.home() / ".TinyTeX" / "bin",
    ]
    for root in roots:
        if root.is_file():
            return root.parent if (root.parent / "pdflatex").exists() else None
        if not root.exists():
            continue
        if (root / "pdflatex").exists() or (root / "latexmk").exists():
            return root
        for child in sorted(root.glob("*")):
            if (child / "pdflatex").exists() or (child / "latexmk").exists():
                return child
    which = shutil.which("pdflatex")
    return Path(which).parent if which else None


def node_dir() -> Path:
    return runtime_dir() / "node"


def npm_prefix() -> Path:
    return runtime_dir() / "npm"


def node_bin() -> Path | None:
    candidate = node_dir() / "bin" / "node"
    if candidate.exists():
        return candidate
    which = shutil.which("node")
    return Path(which) if which else None


def _node_version(binary: Path) -> tuple[int, int, int] | None:
    try:
        out = subprocess.check_output([str(binary), "-v"], text=True).strip().lstrip("v")
        parts = [int(p) for p in out.split(".")[:3]]
        return (parts[0], parts[1], parts[2])
    except Exception:
        return None


def _node_is_new_enough(binary: Path) -> bool:
    ver = _node_version(binary)
    return bool(ver and ver >= (22, 22, 0))


def npm_bin() -> Path | None:
    candidate = node_dir() / "bin" / "npm"
    if candidate.exists():
        return candidate
    which = shutil.which("npm")
    return Path(which) if which else None


def feynman_bin() -> Path | None:
    candidate = npm_prefix() / "bin" / "feynman"
    if candidate.exists():
        return candidate
    which = shutil.which("feynman")
    return Path(which) if which else None


def _download(url: str, dest: Path, progress: Progress, label: str) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    progress(f"Downloading {label}…")
    req = urllib.request.Request(url, headers={"User-Agent": "Yggdrasil-desktop"})
    with urllib.request.urlopen(req, timeout=120) as resp, dest.open("wb") as out:
        shutil.copyfileobj(resp, out)


def _run(cmd: list[str], progress: Progress, env: dict[str, str] | None = None) -> None:
    merged = os.environ.copy()
    if env:
        merged.update(env)
    subprocess.run(cmd, check=True, env=merged, capture_output=True, text=True)


def ensure_tinytex(progress: Progress) -> Path:
    existing = tex_bin_dir()
    if existing:
        progress("LaTeX is already installed.")
        return existing

    progress("Installing LaTeX (TinyTeX). This is a one-time download…")
    script = runtime_dir() / "cache" / "install-tinytex.sh"
    _download(TINYTEX_INSTALL, script, progress, "TinyTeX installer")
    script.chmod(0o755)
    env = os.environ.copy()
    env["TINYTEX_INSTALLER"] = "true"
    subprocess.run(["bash", str(script)], check=True, env=env)

    found = tex_bin_dir()
    if not found:
        raise RuntimeError("TinyTeX installed but pdflatex was not found.")
    ensure_tex_packages(progress)
    return found


ESSENTIAL_TEX_PACKAGES = (
    "latexmk",
    "epsf",
    "graphics",
    "tools",
    "natbib",
    "hyperref",
    "url",
    "booktabs",
    "amsmath",
    "amsfonts",
    "xcolor",
    "collection-fontsrecommended",
)


def ensure_tex_packages(progress: Progress) -> None:
    tex = tex_bin_dir()
    if not tex:
        return
    tlmgr = tex / "tlmgr"
    if not tlmgr.exists():
        found = shutil.which("tlmgr")
        tlmgr = Path(found) if found else None
    if not tlmgr:
        return
    progress("Adding LaTeX packages used by papers…")
    try:
        subprocess.run(
            [str(tlmgr), "install", *ESSENTIAL_TEX_PACKAGES],
            check=False,
            capture_output=True,
            text=True,
            timeout=300,
        )
    except Exception:
        progress("Some LaTeX packages can be added the first time you compile.")


def ensure_aastex(progress: Progress, bundle: Path) -> None:
    src = bundle / "latex"
    if not src.exists():
        return
    texmf = support_dir() / "texmf"
    dest_cls = texmf / "tex" / "latex" / "aastex701"
    dest_bst = texmf / "bibtex" / "bst" / "aastex"
    dest_gemini = texmf / "tex" / "latex" / "gemini"
    dest_cls.mkdir(parents=True, exist_ok=True)
    dest_bst.mkdir(parents=True, exist_ok=True)
    dest_gemini.mkdir(parents=True, exist_ok=True)
    aastex = src / "aastex"
    posters = src / "posters"
    if aastex.exists():
        for name in ("aastex701.cls", "orcid-ID.png"):
            item = aastex / name
            if item.exists():
                shutil.copy2(item, dest_cls / name)
        bst = aastex / "aasjournalv7.bst"
        if bst.exists():
            shutil.copy2(bst, dest_bst / bst.name)
    if posters.exists():
        for item in posters.glob("*.sty"):
            shutil.copy2(item, dest_gemini / item.name)
    os.environ["TEXMFHOME"] = str(texmf)
    progress("Installed AASTeX / poster templates.")


def ensure_node(progress: Progress) -> Path:
    existing = node_bin()
    if existing and _node_is_new_enough(existing):
        progress("Node.js is already installed.")
        return existing
    if existing and existing.parent.parent == node_dir():
        progress("Updating Node.js so Feynman can install…")
        shutil.rmtree(node_dir(), ignore_errors=True)

    arch = "arm64" if platform.machine() == "arm64" else "x64"
    name = f"node-{NODE_VERSION}-darwin-{arch}"
    url = f"https://nodejs.org/dist/{NODE_VERSION}/{name}.tar.gz"
    archive = runtime_dir() / "cache" / f"{name}.tar.gz"
    _download(url, archive, progress, "Node.js")
    progress("Installing Node.js…")
    dest = node_dir()
    if dest.exists():
        shutil.rmtree(dest)
    with tarfile.open(archive, "r:gz") as tar:
        tar.extractall(runtime_dir() / "cache")
    extracted = runtime_dir() / "cache" / name
    shutil.move(str(extracted), dest)
    binary = dest / "bin" / "node"
    if not binary.exists():
        raise RuntimeError("Node.js extracted but the node binary is missing.")
    return binary


def ensure_feynman(progress: Progress) -> Path | None:
    existing = feynman_bin()
    if existing:
        progress("Feynman is already installed.")
        return existing

    npm = npm_bin()
    if not npm:
        progress("Feynman skipped (npm not found). You can still use the rest of the app.")
        return None
    prefix = npm_prefix()
    prefix.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env["npm_config_prefix"] = str(prefix)
    env["npm_config_update_notifier"] = "false"
    env["npm_config_engine_strict"] = "false"
    path_parts = [str(node_dir() / "bin"), env.get("PATH", "")]
    env["PATH"] = os.pathsep.join(p for p in path_parts if p)
    last_err = ""
    for attempt in range(1, 4):
        progress(f"Installing Feynman (try {attempt} of 3)…")
        result = subprocess.run(
            [str(npm), "install", "-g", FEYNMAN_PKG],
            env=env,
            capture_output=True,
            text=True,
        )
        if result.returncode == 0:
            found = feynman_bin()
            if found:
                return found
            last_err = "Feynman installed but the command was not found."
            break
        last_err = (result.stderr or result.stdout or "npm install failed").strip()[-400:]
    progress("Feynman can be installed later. Opening the app…")
    return None


def prepend_path(*dirs: Path | None) -> None:
    extra = [str(d) for d in dirs if d and d.exists()]
    os.environ["PATH"] = os.pathsep.join(extra + [os.environ.get("PATH", "")])


def validate_tex_toolchain(progress: Progress) -> Path:
    tex = tex_bin_dir()
    if not tex:
        raise RuntimeError("TinyTeX was not found after setup.")

    required = ["latexmk", "pdflatex", "lualatex", "xelatex"]
    missing = [name for name in required if not (tex / name).exists() and not shutil.which(name)]
    if missing:
        raise RuntimeError(
            "LaTeX tools are incomplete in the desktop app. Missing: " + ", ".join(missing)
        )

    progress("LaTeX toolchain verified.")
    return tex


def ensure_all(bundle: Path, progress: Progress) -> dict[str, str]:
    support_dir().mkdir(parents=True, exist_ok=True)
    tex = ensure_tinytex(progress)
    ensure_aastex(progress, bundle)
    ensure_tex_packages(progress)
    tex = validate_tex_toolchain(progress)
    prepend_path(tex)
    os.environ["TEXMFHOME"] = str(support_dir() / "texmf")
    marker = {
        "tinytex": str(tex) if tex else "",
        "node": "",
        "feynman": "",
    }
    import json

    marker_path().write_text(json.dumps(marker, indent=2))
    progress("All tools are ready.")
    return marker


def load_or_ensure(bundle: Path, progress: Progress) -> dict[str, str]:
    if marker_path().exists() and tex_bin_dir():
        progress("Using tools installed on the first launch.")
        tex = tex_bin_dir()
        try:
            tex = validate_tex_toolchain(progress)
        except RuntimeError:
            progress("Reinstalling LaTeX toolchain because the bundled tools are incomplete.")
            return ensure_all(bundle, progress)
        prepend_path(tex)
        os.environ["TEXMFHOME"] = str(support_dir() / "texmf")
        ensure_tex_packages(progress)
        return {
            "tinytex": str(tex) if tex else "",
            "node": "",
            "feynman": "",
        }
    return ensure_all(bundle, progress)
