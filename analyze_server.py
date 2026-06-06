import re

with open(r'C:\Users\aoogoost\Desktop\Projekt\git008\hf_server.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Find @app decorators with their routes
matches = re.findall(r'@app\.(get|post|websocket|delete)\([\'"]([^\'"]+)[\'"].*?\)(?:\s*\n\s*async def (\w+))?', content)
for m in matches:
    print(f'{m[0].upper():8s} {m[1]:40s} def {m[2]}')

print("\n=== KEY PATTERNS ===")
for pattern in ['StaticFiles', 'mount', 'Port', 'HOST', 'BIND', 'uvicorn', 'PORT', ':8000', ':7860', '__main__', 'if __name__']:
    idx = content.find(pattern)
    if idx >= 0:
        print(f'\n--- Found {pattern} at position {idx}:')
        print(content[max(0,idx-50):idx+300])