KARPATHY_CONSTITUTION = """
1. Think Before Coding: Explicitly state assumptions. If uncertain or ambiguous, STOP and ASK.
2. Simplicity First: Write minimal, necessary code. No speculative features or over-engineering.
3. Surgical Changes: Only touch what is necessary for the current task. Do not refactor unrelated code.
4. Goal-Driven Execution: Every step must be verifiable. Define success criteria clearly before execution.
"""

def anti_freeze_check(plan_steps):
    if len(plan_steps) > 8:
        raise ValueError("思维冻结：步骤超限，请拆分任务并遵循 Simplicity First 原则。")
    return True