"""Report repeated production Go blocks for semantic review; this is not a gate."""
from collections import defaultdict
from pathlib import Path

blocks = defaultdict(list)
for path in sorted(Path("internal").rglob("*.go")):
    if path.name.endswith("_test.go"):
        continue
    lines = path.read_text().splitlines()
    for offset in range(len(lines) - 11):
        block = tuple(line.strip() for line in lines[offset:offset + 12])
        if sum(bool(line) and line not in ("{", "}") for line in block) < 8:
            continue
        blocks[block].append(f"{path}:{offset + 1}")
for locations in blocks.values():
    if len(locations) > 1:
        print(" | ".join(locations))
