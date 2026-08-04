import re

with open(r'C:\Users\aoogoost\Desktop\Projekt\git008\pr28.diff', 'r', encoding='utf-8') as f:
    content = f.read()

# Split by diff --git
sections_raw = content.split('diff --git ')
sections = {}
for s in sections_raw[1:]:
    lines = s.split('\n')
    header = lines[0]
    path_match = re.match(r'a/(.+?) b/', header)
    if path_match:
        path = path_match.group(1)
        sections[path] = '\n'.join(lines[1:])

for path, data in sorted(sections.items()):
    print(f"=== {path} ===")
    print(f"  Length: {len(data)} chars")
    # Show first 3 lines
    first_lines = data.split('\n')[:3]
    for line in first_lines:
        print(f"  {line}")
    print()
# === Constitution Governance Hook ===
import sys as _sys
import os as _os
_gov_rules = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), '..', 'constitution')
if _gov_rules not in _sys.path:
    _sys.path.insert(0, _gov_rules)
try:
    import rules as _gov
    KARPATHY_CONSTITUTION = _gov.KARPATHY_CONSTITUTION
    anti_freeze_check = _gov.anti_freeze_check
    anti_freeze_check(["init", "execute", "validate"])
except ImportError:
    KARPATHY_CONSTITUTION = ""
    def anti_freeze_check(steps): return True
