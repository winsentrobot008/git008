import re

with open('livebench/api/server.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix all 'r') as f: pattern to 'r', encoding='utf-8') as f:
# But avoid already-fixed ones
patterns = [
    "with open(balance_file, 'r') as f:",
    "with open(decision_file, 'r') as f:",
    "with open(evaluations_file, 'r') as f:",
    "with open(tasks_file, 'r') as f:",
    "with open(completions_file, 'r') as f:",
    "with open(HIDDEN_AGENTS_PATH, 'r') as f:",
]

for pattern in patterns:
    old = pattern
    new = pattern.replace("'r'", "'r', encoding='utf-8'")
    count = content.count(old)
    if count > 0:
        print(f"Replacing {count} occurrence(s) of: {pattern}")
        content = content.replace(old, new)
    else:
        print(f"  (none found) {pattern}")

with open('livebench/api/server.py', 'w', encoding='utf-8') as f:
    f.write(content)

print("\nAll done!")