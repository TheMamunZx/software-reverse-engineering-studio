#!/usr/bin/env python3
"""Create a small workspace scaffold for Software Reverse Engineering Studio."""
from pathlib import Path
import argparse

def main():
    p=argparse.ArgumentParser()
    p.add_argument("name", help="Project folder name")
    p.add_argument("--output", default=".")
    a=p.parse_args()
    safe=Path(a.name)
    if safe.is_absolute() or ".." in safe.parts:
        p.error("name must be a safe relative folder name")
    root=(Path(a.output).resolve()/safe).resolve()
    root.mkdir(parents=True,exist_ok=False)
    for d in ["docs","src","tests","artifacts"]: (root/d).mkdir()
    (root/"README.md").write_text("# "+safe.name+"\n\nProject created with software-reverse-engineering-studio.\n",encoding="utf-8")
    print(root)
if __name__ == "__main__": main()
