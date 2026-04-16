"""Build the static GitHub Pages site artifact."""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "_site"

ROOT_FILES = [
    "index.html",
    ".nojekyll",
    "python_manifest.json",
]

TREE_DIRS = [
    "core",
    "web",
    "app",
    "assets",
]


def generate_python_manifest(root: Path) -> None:
    """Write python_manifest.json at the repo root from BROWSER_PYTHON_FILES in the registry.

    The file is committed to the repo so that local development (python3 -m http.server)
    works without running the build script first. The build script copies it to _site/.
    """
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    from app.registry import BROWSER_PYTHON_FILES  # noqa: PLC0415
    manifest_data = json.dumps({"python_files": BROWSER_PYTHON_FILES}, indent=2) + "\n"
    (root / "python_manifest.json").write_text(manifest_data)
    print(f"Generated python_manifest.json ({len(BROWSER_PYTHON_FILES)} files)")


def main() -> None:
    if len(sys.argv) > 2:
        raise SystemExit("Usage: python scripts/build_pages_site.py [output_dir]")

    output_dir = Path(sys.argv[1]).resolve() if len(sys.argv) == 2 else DEFAULT_OUTPUT
    generate_python_manifest(ROOT)

    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    for relative_path in ROOT_FILES:
        source = ROOT / relative_path
        destination = output_dir / relative_path
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)

    ignore_patterns = shutil.ignore_patterns("__pycache__", "*.pyc", ".DS_Store")
    for relative_dir in TREE_DIRS:
        source_dir = ROOT / relative_dir
        destination_dir = output_dir / relative_dir
        shutil.copytree(source_dir, destination_dir, ignore=ignore_patterns)

    print(f"Built static site at: {output_dir}")


if __name__ == "__main__":
    main()
