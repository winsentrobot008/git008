import logging
from typing import Tuple

class RiskManager:
    # Risk levels 1-5 (1 = lowest risk, 5 = highest/critical risk)
    RISK_LOW = 1
    RISK_MODERATE = 2
    RISK_ELEVATED = 3
    RISK_HIGH = 4
    RISK_CRITICAL = 5

    # Threshold above which tasks are BLOCKED (level > THRESHOLD)
    BLOCK_THRESHOLD = 3

    def __init__(self):
        logging.info("Initializing Financial & Operational Risk Breaker (Phase 4 Enhanced)...")
        self.blacklisted_keywords = ["rm -rf", "drop table", "private_key", "transfer_all"]
        
        # Keyword-based risk scoring map
        self.keyword_risk_map = {
            "transfer_all": self.RISK_CRITICAL,   # 5
            "drop table": self.RISK_CRITICAL,      # 5
            "private_key": self.RISK_HIGH,          # 4
            "rm -rf": self.RISK_HIGH,               # 4
            "delete": self.RISK_ELEVATED,           # 3
            "uninstall": self.RISK_ELEVATED,        # 3
            "format": self.RISK_ELEVATED,           # 3
            "shutdown": self.RISK_MODERATE,         # 2
            "reboot": self.RISK_MODERATE,           # 2
        }
        
        # Action-pattern risk scoring
        self.action_risk_map = {
            "transfer": self.RISK_CRITICAL,
            "pay": self.RISK_CRITICAL,
            "withdraw": self.RISK_CRITICAL,
            "publish": self.RISK_MODERATE,
            "deploy": self.RISK_MODERATE,
            "install": self.RISK_LOW,
            "build": self.RISK_LOW,
            "test": self.RISK_LOW,
            "analyze": self.RISK_LOW,
            "scan": self.RISK_LOW,
        }

    def evaluate_task(self, task_description: str) -> Tuple[bool, str]:
        """
        Legacy interface: returns (is_safe, message).
        Uses the new risk-level evaluation internally.
        """
        level, message = self.evaluate_task_risk_level(task_description)
        is_safe = level <= self.BLOCK_THRESHOLD
        if not is_safe:
            return False, f"BLOCKED (risk level {level}/5): {message}"
        return True, message

    def evaluate_task_risk_level(self, task_description: str) -> Tuple[int, str]:
        """
        Evaluate a task and return a numeric risk level (1-5) and detailed message.
        
        Risk level mapping:
          1 = LOW       — safe, read-only or analysis operations
          2 = MODERATE  — non-destructive writes, installs
          3 = ELEVATED  — destructive writes, system configuration
          4 = HIGH      — security-sensitive, data deletion
          5 = CRITICAL  — financial transactions, full system access
        
        Args:
            task_description: The task description or goal string.
            
        Returns:
            Tuple of (risk_level: int, message: str)
        """
        description_lower = task_description.lower()
        max_risk_level = self.RISK_LOW
        triggered_reasons = []

        # 1. Keyword-based risk scanning
        for keyword, risk_score in self.keyword_risk_map.items():
            if keyword in description_lower:
                if risk_score > max_risk_level:
                    max_risk_level = risk_score
                triggered_reasons.append(f"keyword '{keyword}' (level {risk_score})")

        # 2. Action-pattern risk scanning
        for action, risk_score in self.action_risk_map.items():
            if action in description_lower:
                if risk_score > max_risk_level:
                    max_risk_level = risk_score
                triggered_reasons.append(f"action '{action}' (level {risk_score})")

        # 3. Financial transaction compound check
        if "transfer" in description_lower or "pay" in description_lower or "withdraw" in description_lower:
            if max_risk_level < self.RISK_CRITICAL:
                max_risk_level = self.RISK_CRITICAL
            triggered_reasons.append("financial transaction detected (level 5)")

        # 4. Blacklisted keywords — always critical
        for word in self.blacklisted_keywords:
            if word in description_lower:
                if max_risk_level < self.RISK_CRITICAL:
                    max_risk_level = self.RISK_CRITICAL
                triggered_reasons.append(f"blacklisted keyword '{word}'")

        # Build message
        if max_risk_level <= self.BLOCK_THRESHOLD:
            message = f"Task Passed Risk Assessment (level {max_risk_level}/5)."
        elif max_risk_level == self.RISK_HIGH:
            message = f"HIGH RISK (level {max_risk_level}/5): {', '.join(triggered_reasons)}. Manual review recommended."
        else:
            message = f"CRITICAL RISK (level {max_risk_level}/5): {', '.join(triggered_reasons)}. Task BLOCKED."

        return max_risk_level, message

    def should_block(self, task_description: str) -> Tuple[bool, int, str]:
        """
        Evaluate if a task should be blocked based on risk level.
        
        Returns:
            Tuple of (should_block: bool, risk_level: int, message: str)
        """
        level, message = self.evaluate_task_risk_level(task_description)
        should_block = level > self.BLOCK_THRESHOLD
        return should_block, level, message
