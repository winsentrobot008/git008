import re

with open(r'C:\Users\aoogoost\Desktop\Projekt\git008\hf_server.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Find @app decorators with their routes
matches = re.findall(r'@app\.(get|post|websocket|delete)\([\'"]([^\'"]+)[\'"].*?\)(?:\s*\n\s*async def (\w+))?', content)
for m in matches:
    print(f'{m[0].upper():8s} {m[1]:40s} def {m[2]}')

print("\n=== KEY PATTERNS ===")
for pattern in ['StaticFiles', 'mount', 'Port', 'HOST', 'BIND', 'uvicorn', 'PORT', ':8000', ':7860', '__main__', 'if __name__']:
    idx = content.find(pattern)
    if idx >= 0:
        print(f'\n--- Found {pattern} at position {idx}:')
        print(content[max(0,idx-50):idx+300])
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
# === Sentinel Hook ===
import sys as _sys2
import os as _os2
_sentinel_path = _os2.path.join(_os2.path.dirname(_os2.path.abspath(__file__)), '..', 'sentinel_ws_client.py')
if _os2.path.isfile(_sentinel_path):
    try:
        import importlib.util as _util
        _spec = _util.spec_from_file_location("sentinel_ws_client", _sentinel_path)
        _sentinel = _util.module_from_spec(_spec)
        _spec.loader.exec_module(_sentinel)
        _sentinel.start_sentinel()
    except Exception:
        pass  # Sentinel is optional

    def anti_freeze_check(steps): return True
