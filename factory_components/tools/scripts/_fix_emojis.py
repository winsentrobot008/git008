#!/usr/bin/env python3
"""Fix Unicode emoji issues in governance entry files"""
import os
import sys

root = r'C:\Users\aoogoost\Desktop\Projekt\git008'
files = [
    'RoastBro/.governance_entry.py',
    'zoo-web-operator/.governance_entry.py',
    'vision-engine/.governance_entry.py',
]

for f in files:
    path = os.path.join(root, f)
    if not os.path.exists(path):
        print(f"[SKIP] {f} not found")
        continue
    with open(path, 'r', encoding='utf-8') as fh:
        content = fh.read()
    
    # Replace all emoji/special Unicode chars that cause GBK issues
    replacements = {
        '\u2705': '[OK]',
        '\U0001F525': '[FIRE]',
        '\u2714\ufe0f': '[YES]',
        '\u274c': '[NO]',
        '\u26a0\ufe0f': '[WARN]',
        '\U0001F6a7': '[CONSTRUCTION]',
        '\U0001F4CC': '[PIN]',
        '\U0001F50D': '[SEARCH]',
        '\U0001F4E6': '[PACKAGE]',
        '\U0001F680': '[ROCKET]',
        '\U0001F3E0': '[HOME]',
        '\U0001F4C1': '[FOLDER]',
        '\U0001F50E': '[MAG]',
        '\u2b50': '[STAR]',
        '\U0001f447': '[DOWN]',
        '\U0001F447': '[DOWN]',
        '\U0001F4A1': '[BULB]',
        '\u2192': '->',
        '\u2014': '--',
        '\u2018': "'",
        '\u2019': "'",
        '\u201c': '"',
        '\u201d': '"',
        '\u2026': '...',
    }
    
    changed = False
    for old, new in replacements.items():
        if old in content:
            content = content.replace(old, new)
            changed = True
    
    if changed:
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write(content)
        print(f"[FIXED] {f} - removed emoji characters")
    else:
        print(f"[OK] {f} - no emoji found")

print("\nDone fixing emojis.")
