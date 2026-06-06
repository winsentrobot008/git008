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