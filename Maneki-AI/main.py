import logging
from enum import Enum
from dataclasses import dataclass

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - [%(levelname)s] - %(message)s')

class AIModel(Enum):
    GEMINI = "Gemini (Orchestrator & Strategy)"
    DEEPSEEK = "DeepSeek (Logic & Architecture)"
    DOUBAO = "Doubao (Creative & Localization)"
    YUANBAO = "Yuanbao (Ecosystem Integration)"
    OPENAI = "OpenAI/Claude (Global Standards)"

@dataclass
class Task:
    task_id: str
    description: str
    tags: list[str]

class TaskDispatcher:
    def __init__(self):
        logging.info("Initializing Maneki-AI ECC Task Dispatcher...")
        # Define the routing matrix
        self.routing_rules = {
            "strategy": AIModel.GEMINI,
            "orchestration": AIModel.GEMINI,
            "code": AIModel.DEEPSEEK,
            "logic": AIModel.DEEPSEEK,
            "creative": AIModel.DOUBAO,
            "marketing": AIModel.DOUBAO,
            "social": AIModel.YUANBAO,
            "audit": AIModel.OPENAI,
            "standardization": AIModel.OPENAI
        }

    def route_task(self, task: Task) -> AIModel:
        logging.info(f"Analyzing Task [{task.task_id}]: {task.description}")
        
        # Determine the best model based on tags
        assigned_model = None
        for tag in task.tags:
            if tag.lower() in self.routing_rules:
                assigned_model = self.routing_rules[tag.lower()]
                break
        
        # Default to Orchestrator if no specific tag matches
        if not assigned_model:
            assigned_model = AIModel.GEMINI
            logging.warning(f"No explicit tag match. Defaulting to {assigned_model.value}.")

        logging.info(f"Task [{task.task_id}] successfully routed to: {assigned_model.value}")
        return assigned_model

# --- Mock Execution for Testing ---
if __name__ == "__main__":
    dispatcher = TaskDispatcher()
    
    # Simulate incoming tasks
    tasks = [
        Task("T-001", "Design the global architecture for the new crypto game.", ["strategy"]),
        Task("T-002", "Write the Python backend for the payment gateway.", ["code"]),
        Task("T-003", "Draft a viral Xiaohongshu post for the new release.", ["creative"])
    ]

    print("\n--- Starting Factory Dispatch Cycle ---")
    for t in tasks:
        selected_ai = dispatcher.route_task(t)
        # Here we would call the actual API for the selected_ai
        print(f"Executing with {selected_ai.name}...\n")
