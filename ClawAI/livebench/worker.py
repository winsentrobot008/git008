import threading
import time
import queue
import openai
import os

task_queue = queue.Queue()
worker_thread = None

def process_task(task_id, description):
    try:
        client = openai.OpenAI(
            api_key=os.getenv("OPENAI_API_KEY"),
            base_url=os.getenv("OPENAI_BASE_URL", "https://api.deepseek.com/v1")
        )
        response = client.chat.completions.create(
            model="deepseek-chat",
            messages=[{"role": "user", "content": description}],
            temperature=0.7
        )
        result = response.choices[0].message.content
        # 这里你需要把结果更新回任务存储（简化：打印到日志）
        print(f"[Worker] Task {task_id} completed: {result[:100]}...")
        # 实际应通过WebSocket广播，但先保证能执行
    except Exception as e:
        print(f"[Worker] Task {task_id} failed: {e}")

def worker_loop():
    while True:
        try:
            task_id, description = task_queue.get(timeout=2)
            process_task(task_id, description)
            task_queue.task_done()
        except queue.Empty:
            time.sleep(1)

def start_worker():
    global worker_thread
    if worker_thread is None or not worker_thread.is_alive():
        worker_thread = threading.Thread(target=worker_loop, daemon=True)
        worker_thread.start()
        print("[Worker] Started")

def add_task(task_id, description):
    task_queue.put((task_id, description))
    start_worker()