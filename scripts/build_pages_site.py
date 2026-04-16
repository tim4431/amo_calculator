"""Build the static GitHub Pages site artifact."""

from __future__ import annotations

import shutil
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "_site"

ROOT_FILES = [
    "index.html",
    ".nojekyll",
]

TREE_DIRS = [
    "core",
    "web",
    "app",
    "assets",
]


def main() -> None:
    if len(sys.argv) > 2:
        raise SystemExit("Usage: python scripts/build_pages_site.py [output_dir]")

    output_dir = Path(sys.argv[1]).resolve() if len(sys.argv) == 2 else DEFAULT_OUTPUT
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
