from abc import ABC, abstractmethod

class BaseAgent(ABC):
    name = "base_agent"

    @abstractmethod
    def analyze(self, raw_data):
        pass
