import queue
import threading


class TaskQueue:
    def __init__(self):
        self.queue = queue.Queue()
        self.lock = threading.Lock()

    def add_task(self, task):
        with self.lock:
            self.queue.put(task)

    def get_task(self):
        with self.lock:
            if not self.queue.empty():
                return self.queue.get()
            return None

    def size(self):
        return self.queue.qsize()


task_queue = TaskQueue()
