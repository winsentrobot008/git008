import logging

class RiskManager:
    def __init__(self):
        logging.info("Initializing Financial & Operational Risk Breaker...")
        self.blacklisted_keywords = ["rm -rf", "drop table", "private_key", "transfer_all"]

    def evaluate_task(self, task_description: str) -> tuple[bool, str]:
        description_lower = task_description.lower()
        
        # 1. Security check
        for word in self.blacklisted_keywords:
            if word in description_lower:
                return False, f"BLOCKED: Task contains high-risk keyword '{word}'."
        
        # 2. Financial isolation check
        if "transfer" in description_lower or "pay" in description_lower:
             return False, "BLOCKED: Financial transactions require explicit manual multi-sig approval."
             
        return True, "Task Passed Risk Assessment."
