from flask import Flask, request, jsonify
import json
import os

app = Flask(__name__)

QUEUE_FILE = "bridge_queue.json"

def append_task(task):
    if not os.path.exists(QUEUE_FILE):
        with open(QUEUE_FILE, "w") as f:
            json.dump([], f)

    with open(QUEUE_FILE, "r") as f:
        queue = json.load(f)

    queue.append(task)

    with open(QUEUE_FILE, "w") as f:
        json.dump(queue, f, indent=2)

@app.route("/task", methods=["POST"])
def receive_task():
    data = request.get_json()
    append_task(data)
    print("Received task:", data)
    return jsonify({"status": "received", "task_id": data.get("id")})

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5005))
    app.run(host="0.0.0.0", port=port)
