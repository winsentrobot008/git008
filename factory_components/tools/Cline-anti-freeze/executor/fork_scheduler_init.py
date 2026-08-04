
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
