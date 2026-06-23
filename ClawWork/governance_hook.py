import os
import time
import sys

def ensure_governance():
    ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    GOV = os.path.join(ROOT, "Cline-anti-freeze")
    sys.path.append(GOV)

    try:
        import governance_linker
        governance_linker.ensure_governance()
        print("[Governance Hook] 项目已自动注入治理体系")
    except Exception as e:
        print("[Governance Hook] 注入失败:", e)

ensure_governance()
