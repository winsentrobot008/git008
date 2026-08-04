# frontend/server.py — Resource-Fixed Static Router + API Gateway
import io
from pydub import AudioSegment
import http.server
import socketserver
import os
import subprocess
import json
import shutil
import urllib.parse
import traceback
import time
import hashlib

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8082
FRONTEND_DIR = os.path.join(PROJECT_ROOT, 'frontend')
OUTPUT_DIR = os.path.join(PROJECT_ROOT, 'output')

os.makedirs(OUTPUT_DIR, exist_ok=True)

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=FRONTEND_DIR, **kwargs)

    def _set_headers(self, status, content_type):
        self.send_response(status)
        self.send_header('Content-type', content_type + '; charset=utf-8')
        # === CSP 防火墙：严禁插件注入 ===
        # default-src 'self': 只允许加载同源资源
        # script-src 'self' 'unsafe-inline': 只允许内联脚本，拒绝外部JS
        # frame-src 'none': 禁止iframe嵌套
        # object-src 'none': 禁止Flash/ActiveX等老旧插件
        csp = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: http://localhost:8082; connect-src 'self' http://localhost:8082; frame-src 'none'; object-src 'none'; base-uri 'self';"
        self.send_header('Content-Security-Policy', csp)
        self.end_headers()

    def do_GET(self):
        # 拦截分发生成的音频静态文件（优先级最高）
        if self.path.startswith('/output/'):
            filename = self.path.split('/')[-1].split('?')[0]  # 去除时间戳缓存后缀
            target_file = os.path.join(PROJECT_ROOT, 'output', filename)
            if os.path.exists(target_file):
                self._set_headers(200, 'audio/mpeg')
                with open(target_file, 'rb') as f:
                    self.wfile.write(f.read())
            else:
                self._set_headers(404, 'text/plain')
                self.wfile.write(b'Audio File Not Found')
            return
        
        # 1. API 路由
        if self.path.startswith('/api/'):
            self.handle_api_request()
            return
        
        # 2. 前端静态资源
        if self.path == '/':
            self.path = '/index.html'
        
        static_path = os.path.join(FRONTEND_DIR, self.path.lstrip('/'))
        if os.path.exists(static_path) and os.path.isfile(static_path):
            self.send_static_file(static_path)
            return
        
        # 3. 404
        self._set_headers(404, 'text/plain')
        self.wfile.write(b'Resource not found')

    def send_static_file(self, file_path):
        """通用静态文件发送方法"""
        mime_types = {
            '.html': 'text/html',
            '.css': 'text/css',
            '.js': 'application/javascript',
            '.json': 'application/json',
            '.ico': 'image/x-icon',
            '.mp3': 'audio/mpeg',
            '.wav': 'audio/wav'
        }
        ext = os.path.splitext(file_path)[1]
        content_type = mime_types.get(ext, 'application/octet-stream')
        
        self._set_headers(200, content_type)
        with open(file_path, 'rb') as f:
            self.wfile.write(f.read())

    def handle_api_request(self):
        """统一处理所有API请求"""
        try:
            if self.path == '/api/script':
                script_path = os.path.join(PROJECT_ROOT, 'assets/scripts/script.txt')
                self._set_headers(200, 'text/plain')
                if os.path.exists(script_path):
                    with open(script_path, 'r', encoding='utf-8') as f:
                        self.wfile.write(f.read().encode('utf-8'))
                else:
                    self.wfile.write(b'Default script not found')
            
            elif self.path == '/api/list_audio':
                self._set_headers(200, 'application/json')
                if os.path.exists(OUTPUT_DIR):
                    audio_files = [f for f in os.listdir(OUTPUT_DIR) if f.endswith('.mp3')]
                    self.wfile.write(json.dumps(audio_files).encode('utf-8'))
                else:
                    self.wfile.write(json.dumps([]).encode('utf-8'))
            
            else:
                self._set_headers(404, 'text/plain')
                self.wfile.write(b'API endpoint not found')
        
        except Exception as e:
            self._set_headers(500, 'text/plain')
            self.wfile.write(f'API Error: {str(e)}'.encode('utf-8'))

    def do_POST(self):
        content_length = int(self.headers['Content-Length'])
        post_data = self.rfile.read(content_length)
        
        try:
            if self.path == '/api/script':
                script_path = os.path.join(PROJECT_ROOT, 'assets/scripts/script.txt')
                with open(script_path, 'w', encoding='utf-8') as f:
                    f.write(post_data.decode('utf-8'))
                self._set_headers(200, 'text/plain')
                self.wfile.write(b'Script saved successfully')
            
            elif self.path == '/api/upload_ref':
                # 动态识别并进行物理转码
                speaker = self.headers.get('X-Speaker', 'A')
                target_path = os.path.join(PROJECT_ROOT, f'assets/voices/voice_{speaker}_ref.wav')
                os.makedirs(os.path.dirname(target_path), exist_ok=True)
                
                try:
                    # 将内存中的二进制流转为 BytesIO 并使用 pydub 自动探测格式载入
                    audio_stream = io.BytesIO(post_data)
                    segment = AudioSegment.from_file(audio_stream)
                    
                    # 物理统一转码输出为标准的 16kHz 单声道 WAV，保证极高兼容性
                    segment = segment.set_frame_rate(16000).set_channels(1)
                    segment.export(target_path, format='wav')
                    
                    print(f'[Upload Transcoder] 成功自动转换 {speaker} 的音频并物理覆写至: {target_path}')
                    self._set_headers(200, 'text/plain')
                    self.wfile.write(f'Transcode & Upload successful for {speaker}'.encode('utf-8'))
                except Exception as ex:
                    # 兜底退避逻辑：如果转码失败，尝试直接写入
                    with open(target_path, 'wb') as f_out:
                        f_out.write(post_data)
                    print(f'[Upload Transcoder] 转码异常 ({ex})，已使用原始数据覆盖写入。')
                    self._set_headers(200, 'text/plain')
                    self.wfile.write(f'Direct save successful for {speaker}'.encode('utf-8'))
                return

            elif self.path == '/api/generate':
                job_config = json.loads(post_data.decode('utf-8'))
                input_json_path = os.path.join(PROJECT_ROOT, 'input.json')
                with open(input_json_path, 'w', encoding='utf-8') as f:
                    json.dump(job_config, f, ensure_ascii=False, indent=2)
                
                cmd = ['python', 'src/generate.py']
                result = subprocess.run(cmd, cwd=PROJECT_ROOT, capture_output=True, text=True, timeout=60)
                output = result.stdout + result.stderr
                
                # 物理扫描三轨输出文件
                merged_mp3 = ""
                a_only_mp3 = ""
                b_only_mp3 = ""
                try:
                    import glob
                    mp3_files = glob.glob(os.path.join(OUTPUT_DIR, "*_merged.mp3"))
                    if mp3_files:
                        latest_merged = max(mp3_files, key=os.path.getmtime)
                        merged_mp3 = os.path.basename(latest_merged)
                        prefix = merged_mp3.replace('_merged.mp3', '')
                        a_only_mp3 = prefix + '_A_only.mp3'
                        b_only_mp3 = prefix + '_B_only.mp3'
                except Exception as ex:
                    print("Scan Error:", ex)
                
                response_data = {
                    "log": output,
                    "latest_mp3": merged_mp3,
                    "a_only_mp3": a_only_mp3,
                    "b_only_mp3": b_only_mp3
                }
                self._set_headers(200, 'application/json')
                self.wfile.write(json.dumps(response_data).encode('utf-8'))
            
            else:
                self._set_headers(404, 'text/plain')
                self.wfile.write(b'API endpoint not found')
        
        except Exception as e:
            self._set_headers(500, 'text/plain')
            error_msg = f"Internal Server Error:\n{traceback.format_exc()}"
            self.wfile.write(error_msg.encode('utf-8'))

if __name__ == '__main__':
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"VOICE22 Resource-Fixed Server serving at http://localhost:{PORT}")
        httpd.serve_forever()
