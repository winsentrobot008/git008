import re, json

# Load fork server.py
with open(r'C:\Users\aoogoost\Desktop\Projekt\git008\fork_server.py', 'r', encoding='utf-8') as f:
    content = f.read()

print('=== FILE LENGTH ===')
print(len(content), 'bytes')

# Find routes
matches = re.findall(r"@app\.(get|post|websocket|delete|put)\([\"']([^\"']+)[\"']", content)
print('\n=== ROUTES ===')
for m in matches:
    print(f'  {m[0].upper():8s} {m[1]}')

# Check for key patterns
print('\n=== KEY PATTERNS ===')
for keyword in ['scheduler', 'BackgroundTasks', 'live_agent', 'LiveAgent', 'create_task', 'StaticFiles', 'uvicorn', 'if __name__', 'task_scheduler', 'submit_task', 'background_tasks']:
    idx = content.find(keyword)
    if idx >= 0:
        line_num = content[:idx].count('\n') + 1
        print(f'  FOUND "{keyword}" at line {line_num}: ...{content[max(0,idx-20):idx+150]}...')
    else:
        print(f'  NOT FOUND: "{keyword}"')

# Get last 500 chars
print('\n=== LAST 500 CHARS ===')
print(content[-500:])

# Also check fork_main.py
with open(r'C:\Users\aoogoost\Desktop\Projekt\git008\fork_main.py', 'r', encoding='utf-8') as f:
    main_content = f.read()
print('\n=== FORK main.py (first 1000 chars) ===')
print(main_content[:1000])

# Check scheduler __init__.py
with open(r'C:\Users\aoogoost\Desktop\Projekt\git008\fork_scheduler_init.py', 'r', encoding='utf-8') as f:
    sched_content = f.read()
print('\n=== FORK scheduler/__init__.py ===')
print(sched_content)