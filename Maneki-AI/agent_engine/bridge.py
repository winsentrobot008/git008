from flask import Flask, request, jsonify
import json, os, threading, time

app = Flask(__name__)
QUEUE_FILE = os.path.join(os.path.dirname(__file__), 'bridge_queue.json')
RESULTS_FILE = os.path.join(os.path.dirname(__file__), 'bridge_results.json')

def read_queue():
    if not os.path.exists(QUEUE_FILE):
        return []
    try:
        with open(QUEUE_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except:
        return []

def write_queue(q):
    with open(QUEUE_FILE, 'w', encoding='utf-8') as f:
        json.dump(q, f, indent=2, ensure_ascii=False)

@app.route('/send', methods=['POST'])
def send():
    payload = request.json
    q = read_queue()
    q.append(payload)
    write_queue(q)
    return jsonify({'status':'queued','id': payload.get('id')}), 200

@app.route('/results', methods=['POST'])
def results():
    payload = request.json
    r = []
    if os.path.exists(RESULTS_FILE):
        try:
            with open(RESULTS_FILE,'r',encoding='utf-8') as f:
                r = json.load(f)
        except:
            r = []
    r.append(payload)
    with open(RESULTS_FILE,'w',encoding='utf-8') as f:
        json.dump(r, f, indent=2, ensure_ascii=False)
    return jsonify({'status':'ok'}), 200

@app.route('/queue', methods=['GET'])
def queue():
    return jsonify(read_queue()), 200

if __name__ == '__main__':
    app.run(port=5005)
