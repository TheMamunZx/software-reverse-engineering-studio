#!/usr/bin/env python3
"""Validate the single-master-skill package structure."""
from pathlib import Path
import re, sys
ROOT = Path(__file__).resolve().parents[1]
MASTER = "software-reverse-engineering-studio"
EXPECTED = [
  "software-reverse-engineer.md",
  "web-app-analyzer.md",
  "apk-analysis-engineer.md",
  "binary-analysis-engineer.md",
  "api-traffic-analyzer.md",
  "human-centered-product-design.md",
  "design-quality-critic.md",
  "product-experience-engineer.md"
]
BASE = ROOT / ".claude" / "skills" / MASTER
errors=[]
if not (BASE / "SKILL.md").is_file(): errors.append("Missing master SKILL.md")
text=(BASE / "SKILL.md").read_text(encoding="utf-8") if (BASE / "SKILL.md").exists() else ""
if not text.startswith("---\n") or "name: " + MASTER not in text[:500]: errors.append("Invalid or mismatched SKILL.md frontmatter")
for rel in EXPECTED:
    p=BASE / "references" / rel
    if not p.is_file(): errors.append(f"Missing reference: {rel}")
for d in ["scripts","templates","assets"]:
    if not (BASE / d).is_dir(): errors.append(f"Missing directory: {d}")
# Ensure exactly one direct skill entry exists in this package.
skills_root=ROOT/".claude"/"skills"
direct=[p.name for p in skills_root.iterdir() if p.is_dir()] if skills_root.exists() else []
if direct != [MASTER]: errors.append(f"Expected exactly one discoverable skill {MASTER}, found {direct}")
# Basic secret heuristic; allow known placeholders only.
secret_patterns=[r"(?i)sk-[A-Za-z0-9]{20,}", r"(?i)gh[pousr]_[A-Za-z0-9]{20,}", r"(?i)AKIA[0-9A-Z]{16}"]
for p in ROOT.rglob("*"):
    if p.is_file() and ".git" not in p.parts and p.suffix.lower() in {".md",".json",".yaml",".yml",".py",".sh",".ps1",".toml"}:
        try: data=p.read_text(encoding="utf-8")
        except Exception: continue
        for pat in secret_patterns:
            if re.search(pat,data): errors.append(f"Possible credential pattern in {p.relative_to(ROOT)}")
if errors:
    print("VALIDATION FAILED")
    for e in errors: print("-",e)
    sys.exit(1)
print("VALIDATION PASSED")
print("Master skill:", MASTER)
print("Internal references:", len(EXPECTED))
print("Discoverable skill entries:", len(direct))
