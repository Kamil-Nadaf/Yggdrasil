"""The Docker image only gets the modules its Dockerfile COPYs, so a new module that main.py imports
but the Dockerfile forgets makes the container crash at start-up (ModuleNotFoundError)."""
import glob
import re
from pathlib import Path

HERE = Path(__file__).parent


def test_dockerfile_copies_every_imported_module():
    line = next(l for l in (HERE / "Dockerfile").read_text().splitlines() if l.startswith("COPY gate.py"))
    copied = set(line.split()[1:-1])
    mods = {Path(f).stem for f in glob.glob(str(HERE / "*.py")) if not Path(f).name.startswith("test_")}
    needed = set()
    for f in mods:
        for m in re.finditer(r"^\s*(?:from|import)\s+([a-z_]+)", (HERE / f"{f}.py").read_text(), re.M):
            if m.group(1) in mods and m.group(1) != f:
                needed.add(f"{m.group(1)}.py")
    needed.add("main.py")
    assert not (needed - copied), f"Dockerfile COPY is missing: {sorted(needed - copied)}"
