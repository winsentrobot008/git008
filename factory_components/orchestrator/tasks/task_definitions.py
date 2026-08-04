class Task:
    def __init__(self, name, payload=None, priority=5):
        self.name = name
        self.payload = payload or {}
        self.priority = priority

    def __repr__(self):
        return f"<Task {self.name} priority={self.priority}>"
