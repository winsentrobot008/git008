import time, json, os, subprocess, requests

BASE = 'http://127.0.0.1:5005'
QUEUE_FILE = os.path.join(os.path.dirname(__file__), 'bridge_queue.json')

def pop_task():
    if not os.path.exists(QUEUE_FILE):
        return None
    try:
        with open(QUEUE_FILE,'r',encoding='utf-8') as f:
            q = json.load(f)
    except:
        q = []
    if not q:
        return None
    task = q.pop(0)
    with open(QUEUE_FILE,'w',encoding='utf-8') as f:
        json.dump(q, f, indent=2, ensure_ascii=False)
    return task

def run_cmd(cmd):
    try:
        # Use shell for PowerShell/Windows commands
        proc = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=600)
        return {'returncode': proc.returncode, 'stdout': proc.stdout, 'stderr': proc.stderr}
    except Exception as e:
        return {'returncode': -1, 'stdout': '', 'stderr': str(e)}

def post_result(task_id, result):
    payload = {'id': task_id, 'result': result}
    try:
        requests.post(f'{BASE}/results', json=payload, timeout=10)
    except Exception as e:
        print('Failed to post result:', e)

if __name__ == '__main__':
    print('CLINE worker started, polling bridge_queue.json...')
    while True:
        task = pop_task()
        if task:
            print('Got task:', task.get('id'))
            ttype = task.get('type','code')
            payload = task.get('payload','')
            if ttype == 'code':
                res = run_cmd(payload)
                post_result(task.get('id'), res)
            else:
                # For gui or other types, just echo back
                post_result(task.get('id'), {'returncode':0,'stdout':'handled by CLINE (no-op)','stderr':''})
        else:
            time.sleep(1)
