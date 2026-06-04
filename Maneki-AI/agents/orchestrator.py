import time, json, os
from pathlib import Path

TASK_DIR = Path('tasks/queue')
DELIVERIES = Path('deliveries')
LOGS = Path('logs')

LOGS.mkdir(exist_ok=True)
DELIVERIES.mkdir(exist_ok=True)
TASK_DIR.mkdir(parents=True, exist_ok=True)

def log(msg):
    with open(LOGS/'orchestrator.log','a',encoding='utf-8') as f:
        f.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}\n")
    print(msg)

def process_task(path):
    try:
        with open(path,'r',encoding='utf-8') as f:
            task = json.load(f)
    except Exception as e:
        log(f"Failed to read {path}: {e}")
        return
    task_id = task.get('task_id','task_'+str(int(time.time())))
    outdir = DELIVERIES / task_id
    outdir.mkdir(parents=True, exist_ok=True)
    with open(outdir/'logo.png','wb') as img:
        img.write(b'PNG_PLACEHOLDER')
    manifest = {
        'task_id': task_id,
        'type': task.get('type'),
        'client_brief': task.get('client_brief'),
        'deliverables': task.get('deliverables'),
        'generated_at': time.strftime('%Y-%m-%d %H:%M:%S'),
        'mode': 'mock'
    }
    with open(outdir/'manifest.json','w',encoding='utf-8') as m:
        json.dump(manifest, m, ensure_ascii=False, indent=2)
    with open(outdir/'delivery_note.txt','w',encoding='utf-8') as d:
        d.write(f"Delivery for {task_id}\nFiles: {manifest['deliverables']}\nMode: mock\n")
    log(f"Processed task {task_id}, output -> {outdir}")
    os.remove(path)

def main():
    log('Orchestrator started, watching tasks/queue...')
    while True:
        for p in list(TASK_DIR.glob('*.json')):
            process_task(p)
        time.sleep(2)

if __name__ == '__main__':
    main()
