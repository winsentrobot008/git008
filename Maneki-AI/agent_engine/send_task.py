import requests, uuid, json
BASE = 'http://127.0.0.1:5005'
def send_task(payload, ttype='code'):
    tid = str(uuid.uuid4())
    task = {'id': tid, 'type': ttype, 'payload': payload}
    r = requests.post(f'{BASE}/send', json=task, timeout=5)
    print('sent', r.status_code, r.text)
    return tid

if __name__ == '__main__':
    # 示例：让 CLINE 执行一个简单命令
    tid = send_task('echo CLINE_HANDSHAKE_TEST')
    print('task id', tid)
