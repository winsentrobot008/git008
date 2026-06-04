"""
ClawWork Local Workspace Agent
================================
本地代理脚本，负责：
1. 与 Render 云端 FastAPI 后端通信 (https://clawwork-iph9.onrender.com)
2. 监听本地文件变化并同步到云端
3. 接收云端下发的任务并在本地执行（3D 游戏开发等）
4. 将执行结果上报回云端

用法:
    python local_agent.py              # 启动代理（交互模式）
    python local_agent.py --daemon     # 启动代理（守护进程模式）
    python local_agent.py --status     # 查看代理状态
"""

import os
import sys
import json
import time
import asyncio
import hashlib
import argparse
import logging
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, Any, List

import httpx

# ============================================================
# Configuration
# ============================================================

# 云端 Render 地址（已配置指向 Render）
RENDER_API_BASE = os.getenv("CLAWWORK_API_BASE", "https://clawwork-iph9.onrender.com")

# 本地工作目录
WORKSPACE_DIR = Path(__file__).parent.resolve()

# 本地代理监听端口（用于接收云端回调）
LOCAL_AGENT_PORT = int(os.getenv("LOCAL_AGENT_PORT", "18790"))

# 轮询间隔（秒）
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "5"))

# 日志配置
LOG_DIR = WORKSPACE_DIR / ".local_agent"
LOG_DIR.mkdir(exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_DIR / "agent.log", encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
logger = logging.getLogger("ClawWorkAgent")


# ============================================================
# Local Workspace Agent
# ============================================================

class LocalWorkspaceAgent:
    """
    本地工作区代理 — 连接 Render 云端与本地文件系统。
    """

    def __init__(self, api_base: str = RENDER_API_BASE):
        self.api_base = api_base.rstrip("/")
        self.agent_id = f"local_agent_{os.getlogin()}_{WORKSPACE_DIR.name}"
        self.running = False
        self._http_client: Optional[httpx.AsyncClient] = None
        self._file_hashes: Dict[str, str] = {}  # path -> md5 hash
        self._pending_tasks: List[Dict] = []
        self._completed_tasks: List[str] = []

        # 状态文件
        self._state_file = LOG_DIR / "state.json"
        self._load_state()

    # ----------------------------------------------------------
    # HTTP Client
    # ----------------------------------------------------------

    @property
    def http(self) -> httpx.AsyncClient:
        if self._http_client is None or self._http_client.is_closed:
            self._http_client = httpx.AsyncClient(
                timeout=30.0,
                headers={
                    "User-Agent": "ClawWork-LocalAgent/1.0",
                    "X-Agent-ID": self.agent_id,
                },
            )
        return self._http_client

    # ----------------------------------------------------------
    # State Persistence
    # ----------------------------------------------------------

    def _load_state(self):
        """从本地状态文件恢复状态"""
        if self._state_file.exists():
            try:
                data = json.loads(self._state_file.read_text(encoding="utf-8"))
                self._file_hashes = data.get("file_hashes", {})
                self._completed_tasks = data.get("completed_tasks", [])
                logger.info(f"📂 已恢复状态: {len(self._file_hashes)} 个文件哈希, "
                           f"{len(self._completed_tasks)} 个已完成任务")
            except Exception as e:
                logger.warning(f"⚠️ 状态文件读取失败: {e}")

    def _save_state(self):
        """保存状态到本地文件"""
        try:
            data = {
                "file_hashes": self._file_hashes,
                "completed_tasks": self._completed_tasks,
                "last_updated": datetime.now().isoformat(),
            }
            self._state_file.write_text(
                json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
            )
        except Exception as e:
            logger.warning(f"⚠️ 状态保存失败: {e}")

    # ----------------------------------------------------------
    # Cloud Connectivity Checks
    # ----------------------------------------------------------

    async def check_cloud_connection(self) -> bool:
        """检查与 Render 云端的连接"""
        try:
            response = await self.http.get(f"{self.api_base}/", timeout=10.0)
            if response.status_code == 200:
                data = response.json()
                logger.info(f"✅ 云端连接成功: {self.api_base}")
                logger.info(f"   API 版本: {data.get('version', 'unknown')}")
                return True
            else:
                logger.warning(f"⚠️ 云端返回异常状态码: {response.status_code}")
                return False
        except httpx.TimeoutException:
            logger.error(f"❌ 云端连接超时: {self.api_base}")
            return False
        except httpx.ConnectError:
            logger.error(f"❌ 无法连接到云端: {self.api_base}")
            return False
        except Exception as e:
            logger.error(f"❌ 云端连接异常: {e}")
            return False

    async def register_agent(self) -> bool:
        """向云端注册本地代理"""
        try:
            payload = {
                "agent_id": self.agent_id,
                "hostname": os.uname().nodename if hasattr(os, 'uname') else os.getlogin(),
                "workspace": str(WORKSPACE_DIR),
                "platform": sys.platform,
                "python_version": sys.version,
                "capabilities": [
                    "file_read",
                    "file_write",
                    "file_execute",
                    "code_generation",
                    "three_js_game_dev",
                    "cannon_js_physics",
                ],
                "status": "online",
                "registered_at": datetime.now().isoformat(),
            }
            response = await self.http.post(
                f"{self.api_base}/api/local-agents/register",
                json=payload,
                timeout=10.0,
            )
            if response.status_code in (200, 201):
                logger.info(f"✅ 本地代理已注册到云端: {self.agent_id}")
                return True
            else:
                logger.warning(f"⚠️ 代理注册返回 {response.status_code}: {response.text[:200]}")
                return False
        except Exception as e:
            logger.error(f"❌ 代理注册失败: {e}")
            return False

    async def send_heartbeat(self) -> bool:
        """发送心跳到云端"""
        try:
            payload = {
                "agent_id": self.agent_id,
                "status": "online",
                "timestamp": datetime.now().isoformat(),
                "pending_tasks": len(self._pending_tasks),
                "completed_tasks": len(self._completed_tasks),
            }
            response = await self.http.post(
                f"{self.api_base}/api/local-agents/heartbeat",
                json=payload,
                timeout=5.0,
            )
            return response.status_code == 200
        except Exception:
            return False

    # ----------------------------------------------------------
    # File Sync
    # ----------------------------------------------------------

    def _compute_file_hash(self, file_path: Path) -> str:
        """计算文件的 MD5 哈希"""
        try:
            hasher = hashlib.md5()
            with open(file_path, "rb") as f:
                for chunk in iter(lambda: f.read(65536), b""):
                    hasher.update(chunk)
            return hasher.hexdigest()
        except Exception:
            return ""

    def _scan_workspace_files(self) -> Dict[str, str]:
        """扫描工作区文件，返回 {相对路径: md5哈希}"""
        hashes = {}
        extensions = {".py", ".js", ".html", ".css", ".json", ".md", ".txt",
                      ".glb", ".gltf", ".obj", ".mtl", ".png", ".jpg", ".jpeg",
                      ".gif", ".svg", ".mp3", ".wav", ".ttf", ".woff", ".woff2"}
        exclude_dirs = {".git", ".venv", "__pycache__", "node_modules",
                        ".local_agent", ".github", "assets"}

        for file_path in WORKSPACE_DIR.rglob("*"):
            if file_path.is_file() and file_path.suffix.lower() in extensions:
                rel_path = file_path.relative_to(WORKSPACE_DIR)
                if any(part in exclude_dirs for part in rel_path.parts):
                    continue
                try:
                    hash_val = self._compute_file_hash(file_path)
                    if hash_val:
                        hashes[str(rel_path)] = hash_val
                except Exception:
                    continue
        return hashes

    async def sync_files_to_cloud(self):
        """将本地文件变更同步到云端"""
        current_hashes = self._scan_workspace_files()

        changed_files = []
        for path, hash_val in current_hashes.items():
            if path not in self._file_hashes or self._file_hashes[path] != hash_val:
                changed_files.append(path)

        deleted_files = [p for p in self._file_hashes if p not in current_hashes]

        if not changed_files and not deleted_files:
            return

        logger.info(f"📁 检测到文件变更: {len(changed_files)} 个新增/修改, "
                    f"{len(deleted_files)} 个删除")

        for rel_path in changed_files:
            abs_path = WORKSPACE_DIR / rel_path
            try:
                content = abs_path.read_bytes()
                payload = {
                    "agent_id": self.agent_id,
                    "path": rel_path,
                    "content_base64": content.hex(),
                    "size_bytes": len(content),
                    "modified_at": datetime.fromtimestamp(
                        abs_path.stat().st_mtime
                    ).isoformat(),
                }
                response = await self.http.post(
                    f"{self.api_base}/api/local-agents/sync-file",
                    json=payload,
                    timeout=30.0,
                )
                if response.status_code == 200:
                    logger.debug(f"  ✅ 已同步: {rel_path}")
                else:
                    logger.warning(f"  ⚠️ 同步失败 {rel_path}: {response.status_code}")
            except Exception as e:
                logger.warning(f"  ⚠️ 同步异常 {rel_path}: {e}")

        for rel_path in deleted_files:
            try:
                await self.http.post(
                    f"{self.api_base}/api/local-agents/delete-file",
                    json={"agent_id": self.agent_id, "path": rel_path},
                    timeout=10.0,
                )
            except Exception:
                pass

        self._file_hashes = current_hashes
        self._save_state()

    # ----------------------------------------------------------
    # Task Execution
    # ----------------------------------------------------------

    async def poll_tasks(self):
        """从云端轮询待处理任务"""
        try:
            response = await self.http.get(
                f"{self.api_base}/api/local-agents/tasks",
                params={"agent_id": self.agent_id, "status": "pending"},
                timeout=10.0,
            )
            if response.status_code == 200:
                data = response.json()
                tasks = data.get("tasks", [])
                for task in tasks:
                    task_id = task.get("task_id")
                    if task_id and task_id not in self._completed_tasks:
                        self._pending_tasks.append(task)
                        logger.info(f"📥 收到新任务: {task_id}")
                        logger.info(f"   描述: {task.get('description', 'N/A')[:100]}")
        except Exception as e:
            logger.debug(f"任务轮询异常: {e}")

    async def execute_task(self, task: Dict) -> Dict:
        """执行一个任务并返回结果"""
        task_id = task.get("task_id", "unknown")
        task_type = task.get("type", "unknown")
        description = task.get("description", "")
        params = task.get("params", {})

        logger.info(f"🚀 开始执行任务: {task_id}")
        logger.info(f"   类型: {task_type}")
        logger.info(f"   描述: {description[:200]}")

        start_time = time.time()
        result = {
            "task_id": task_id,
            "agent_id": self.agent_id,
            "status": "running",
            "started_at": datetime.now().isoformat(),
            "output": "",
            "files_created": [],
            "error": None,
        }

        try:
            if task_type == "generate_code":
                output = await self._execute_generate_code(task_id, params)
                result.update(output)
            elif task_type == "execute_command":
                output = await self._execute_shell_command(task_id, params)
                result.update(output)
            elif task_type == "read_file":
                output = await self._execute_read_file(task_id, params)
                result.update(output)
            elif task_type == "write_file":
                output = await self._execute_write_file(task_id, params)
                result.update(output)
            elif task_type == "threejs_game":
                output = await self._execute_threejs_game(task_id, params)
                result.update(output)
            else:
                result["status"] = "failed"
                result["error"] = f"未知任务类型: {task_type}"

            elapsed = time.time() - start_time
            result["elapsed_seconds"] = round(elapsed, 2)

            if result["status"] == "running":
                result["status"] = "completed"

            logger.info(f"✅ 任务完成: {task_id} ({result['status']}, {elapsed:.1f}s)")

        except Exception as e:
            elapsed = time.time() - start_time
            result["status"] = "failed"
            result["error"] = str(e)
            result["elapsed_seconds"] = round(elapsed, 2)
            logger.error(f"❌ 任务失败: {task_id} - {e}")

        return result

    async def _execute_generate_code(self, task_id: str, params: Dict) -> Dict:
        """生成代码文件"""
        filename = params.get("filename", f"generated_{task_id[:8]}.py")
        content = params.get("content", "")
        file_path = WORKSPACE_DIR / filename
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_text(content, encoding="utf-8")
        return {
            "status": "completed",
            "output": f"文件已创建: {filename}",
            "files_created": [str(file_path)],
        }

    async def _execute_shell_command(self, task_id: str, params: Dict) -> Dict:
        """执行 shell 命令"""
        command = params.get("command", "")
        cwd = params.get("cwd", str(WORKSPACE_DIR))

        import subprocess
        proc = await asyncio.create_subprocess_shell(
            command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=cwd,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=120.0)
        output = stdout.decode("utf-8", errors="replace")
        error = stderr.decode("utf-8", errors="replace")

        return {
            "status": "completed" if proc.returncode == 0 else "failed",
            "output": output[:5000],
            "error": error[:2000] if error else None,
            "return_code": proc.returncode,
        }

    async def _execute_read_file(self, task_id: str, params: Dict) -> Dict:
        """读取本地文件"""
        filepath = params.get("path", "")
        abs_path = WORKSPACE_DIR / filepath
        if not abs_path.exists():
            return {"status": "failed", "error": f"文件不存在: {filepath}"}
        content = abs_path.read_text(encoding="utf-8", errors="replace")
        return {
            "status": "completed",
            "output": content[:10000],
            "file_path": str(abs_path),
        }

    async def _execute_write_file(self, task_id: str, params: Dict) -> Dict:
        """写入本地文件"""
        filepath = params.get("path", "")
        content = params.get("content", "")
        abs_path = WORKSPACE_DIR / filepath
        abs_path.parent.mkdir(parents=True, exist_ok=True)
        abs_path.write_text(content, encoding="utf-8")
        return {
            "status": "completed",
            "output": f"文件已写入: {filepath}",
            "files_created": [str(abs_path)],
        }

    async def _execute_threejs_game(self, task_id: str, params: Dict) -> Dict:
        """
        执行 Three.js + Cannon.js 3D 游戏开发任务。
        这是核心功能 — 让 ClawWork 网页端能通过本地代理开发 3D 游戏。
        """
        game_name = params.get("game_name", f"game_{task_id[:8]}")
        description = params.get("description", "")
        features = params.get("features", [])

        game_dir = WORKSPACE_DIR / "games" / game_name
        game_dir.mkdir(parents=True, exist_ok=True)

        html_content = params.get("html_content", "")
        js_content = params.get("js_content", "")
        css_content = params.get("css_content", "")

        files_created = []

        if html_content:
            (game_dir / "index.html").write_text(html_content, encoding="utf-8")
            files_created.append(str(game_dir / "index.html"))
        if js_content:
            (game_dir / "game.js").write_text(js_content, encoding="utf-8")
            files_created.append(str(game_dir / "game.js"))
        if css_content:
            (game_dir / "style.css").write_text(css_content, encoding="utf-8")
            files_created.append(str(game_dir / "style.css"))

        if not any([html_content, js_content, css_content]):
            self._generate_default_game(game_dir, game_name, description, features)
            files_created = [
                str(game_dir / "index.html"),
                str(game_dir / "game.js"),
                str(game_dir / "style.css"),
            ]

        return {
            "status": "completed",
            "output": f"3D 游戏已创建: {game_name}\n路径: {game_dir}\n"
                      f"功能: {', '.join(features) if features else '基础模板'}",
            "files_created": files_created,
            "game_url": f"games/{game_name}/index.html",
        }

    def _generate_default_game(self, game_dir: Path, game_name: str,
                                description: str, features: List[str]):
        """生成默认的 Three.js + Cannon.js 游戏"""
        has_physics = "physics" in str(features).lower() or "cannon" in str(features).lower()

        # --- index.html ---
        index_html = (
            '<!DOCTYPE html>\n'
            '<html lang="zh-CN">\n'
            '<head>\n'
            '<meta charset="UTF-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
            f'<title>{game_name} - ClawWork 3D Game</title>\n'
            '<link rel="stylesheet" href="style.css">\n'
            '</head>\n'
            '<body>\n'
            '<div id="info">\n'
            f'  <h1>{game_name}</h1>\n'
            f'  <p>{description or "ClawWork 自动生成的 3D 游戏"}</p>\n'
            '  <p class="controls">🖱 鼠标拖拽旋转 · 滚轮缩放</p>\n'
            '</div>\n'
            '<script type="importmap">\n'
            '{\n'
            '  "imports": {\n'
            '    "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",\n'
            '    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"\n'
            '  }\n'
            '}\n'
            '</script>\n'
            '<script type="module" src="game.js"></script>\n'
            '</body>\n'
            '</html>\n'
        )

        # --- style.css ---
        style_css = (
            '* { margin: 0; padding: 0; box-sizing: border-box; }\n'
            'body { overflow: hidden; background: #000; font-family: Arial, sans-serif; }\n'
            'canvas { display: block; }\n'
            '#info {\n'
            '  position: absolute;\n'
            '  top: 20px;\n'
            '  left: 50%;\n'
            '  transform: translateX(-50%);\n'
            '  color: #fff;\n'
            '  text-align: center;\n'
            '  pointer-events: none;\n'
            '  text-shadow: 0 2px 10px rgba(0,0,0,0.8);\n'
            '  z-index: 10;\n'
            '}\n'
            '#info h1 {\n'
            '  font-size: 1.5rem;\n'
            '  margin-bottom: 0.3rem;\n'
            '  background: linear-gradient(90deg, #00d2ff, #3a7bd5);\n'
            '  -webkit-background-clip: text;\n'
            '  -webkit-text-fill-color: transparent;\n'
            '}\n'
            '#info p { font-size: 0.85rem; opacity: 0.7; }\n'
            '#info .controls { font-size: 0.75rem; opacity: 0.5; margin-top: 0.3rem; }\n'
        )

        # --- game.js ---
        if has_physics:
            game_js = self._get_physics_game_js()
        else:
            game_js = self._get_scene_game_js()

        (game_dir / "index.html").write_text(index_html, encoding="utf-8")
        (game_dir / "style.css").write_text(style_css, encoding="utf-8")
        (game_dir / "game.js").write_text(game_js, encoding="utf-8")

    def _get_physics_game_js(self) -> str:
        """返回带 Cannon.js 物理引擎的 3D 场景 JS"""
        return """import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as CANNON from 'https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/dist/cannon-es.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a2e);
scene.fog = new THREE.Fog(0x0a0a2e, 20, 50);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(8, 6, 12);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
document.body.prepend(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.target.set(0, 1, 0);
controls.maxPolarAngle = Math.PI / 2.2;

// Physics World
const world = new CANNON.World();
world.gravity.set(0, -9.82, 0);
world.broadphase = new CANNON.SAPBroadphase(world);
world.defaultContactMaterial.friction = 0.3;

const groundShape = new CANNON.Plane();
const groundBody = new CANNON.Body({ mass: 0 });
groundBody.addShape(groundShape);
groundBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
world.addBody(groundBody);

// Lighting
const ambientLight = new THREE.AmbientLight(0x404060, 0.5);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffeedd, 2);
dirLight.position.set(10, 20, 10);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
scene.add(dirLight);
const fillLight = new THREE.DirectionalLight(0x4488ff, 0.5);
fillLight.position.set(-10, 5, -10);
scene.add(fillLight);
const hemiLight = new THREE.HemisphereLight(0x4488ff, 0x002244, 0.6);
scene.add(hemiLight);

// Ground
const groundGeo = new THREE.PlaneGeometry(30, 30);
const groundMat = new THREE.MeshStandardMaterial({ color: 0x1a1a3e, roughness: 0.8, metalness: 0.2 });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(30, 30, 0x4444aa, 0x222266);
grid.position.y = 0.01;
scene.add(grid);

// Physics Bodies
const bodies = [];
const colors = [0x00d2ff, 0x3a7bd5, 0xff6b6b, 0xffd93d, 0x6bcb77, 0x4d96ff];

function createBox(x, y, z, size, color) {
  const shape = new CANNON.Box(new CANNON.Vec3(size/2, size/2, size/2));
  const body = new CANNON.Body({ mass: 1 });
  body.addShape(shape);
  body.position.set(x, y, z);
  world.addBody(body);
  const geo = new THREE.BoxGeometry(size, size, size);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.6 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  bodies.push({ body, mesh });
}

function createSphere(x, y, z, radius, color) {
  const shape = new CANNON.Sphere(radius);
  const body = new CANNON.Body({ mass: 1 });
  body.addShape(shape);
  body.position.set(x, y, z);
  world.addBody(body);
  const geo = new THREE.SphereGeometry(radius, 32, 32);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.2, metalness: 0.8 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  bodies.push({ body, mesh });
}

for (let i = 0; i < 8; i++) createBox(0, 0.5 + i * 1.05, 0, 1, colors[i % colors.length]);
const pos = [[-3,1,2],[3,1,-2],[-2,1,-3],[4,1,1],[-4,1,-1],[2,1,3],[-1,2,3],[1,2,-3]];
pos.forEach((p, i) => createSphere(p[0], p[1], p[2], 0.4, colors[(i+3)%colors.length]));

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05);
  world.step(1/60, delta, 3);
  for (const { body, mesh } of bodies) {
    mesh.position.copy(body.position);
    mesh.quaternion.copy(body.quaternion);
  }
  controls.update();
  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
"""

    def _get_scene_game_js(self) -> str:
        """返回纯 Three.js 3D 场景 JS"""
        return """import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a2e);
scene.fog = new THREE.Fog(0x0a0a2e, 30, 60);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(10, 8, 15);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
document.body.prepend(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.target.set(0, 0, 0);
controls.maxPolarAngle = Math.PI / 2.2;

// Lighting
const ambientLight = new THREE.AmbientLight(0x404060, 0.5);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffeedd, 2);
dirLight.position.set(10, 20, 10);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
scene.add(dirLight);
const fillLight = new THREE.DirectionalLight(0x4488ff, 0.5);
fillLight.position.set(-10, 5, -10);
scene.add(fillLight);
const hemiLight = new THREE.HemisphereLight(0x4488ff, 0x002244, 0.6);
scene.add(hemiLight);

// Ground
const groundGeo = new THREE.PlaneGeometry(30, 30);
const groundMat = new THREE.MeshStandardMaterial({ color: 0x1a1a3e, roughness: 0.8, metalness: 0.2 });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(30, 30, 0x4444aa, 0x222266);
grid.position.y = 0.01;
scene.add(grid);

// Objects
const colors = [0x00d2ff, 0x3a7bd5, 0xff6b6b, 0xffd93d, 0x6bcb77, 0x4d96ff];
const group = new THREE.Group();
for (let i = 0; i < 20; i++) {
  const size = 0.3 + Math.random() * 0.5;
  const geo = Math.random() > 0.5
    ? new THREE.BoxGeometry(size, size, size)
    : new THREE.SphereGeometry(size * 0.6, 16, 16);
  const mat = new THREE.MeshStandardMaterial({
    color: colors[Math.floor(Math.random() * colors.length)],
    roughness: 0.3, metalness: 0.7,
  });
  const mesh = new THREE.Mesh(geo, mat);
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.random() * Math.PI;
  const r = 1.5 + Math.random() * 2;
  mesh.position.set(r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi) + 1, r * Math.sin(phi) * Math.sin(theta));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
}
scene.add(group);

// Rings
for (let i = 0; i < 3; i++) {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2 + i * 0.8, 0.05, 16, 64),
    new THREE.MeshStandardMaterial({ color: colors[i], emissive: colors[i], emissiveIntensity: 0.2, transparent: true, opacity: 0.4 })
  );
  ring.position.y = 1.5 + i * 0.5;
  ring.rotation.x = Math.PI / 3;
  ring.rotation.z = i * 0.5;
  scene.add(ring);
}

// Particles
const particleCount = 2000;
const particleGeo = new THREE.BufferGeometry();
const positions = new Float32Array(particleCount * 3);
for (let i = 0; i < particleCount * 3; i++) positions[i] = (Math.random() - 0.5) * 40;
particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
const particles = new THREE.Points(particleGeo, new THREE.PointsMaterial({
  color: 0x4488ff, size: 0.05, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending,
}));
particles.position.y = 5;
scene.add(particles);

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();
  group.rotation.y = t * 0.2;
  group.rotation.x = Math.sin(t * 0.1) * 0.1;
  particles.rotation.y = t * 0.02;
  controls.update();
  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
"""

    # ----------------------------------------------------------
    # Report Results
    # ----------------------------------------------------------

    async def report_task_result(self, result: Dict):
        """将任务执行结果上报到云端"""
        try:
            response = await self.http.post(
                f"{self.api_base}/api/local-agents/task-result",
                json=result,
                timeout=10.0,
            )
            if response.status_code == 200:
                task_id = result.get("task_id", "unknown")
                logger.info(f"📤 任务结果已上报: {task_id}")
                self._completed_tasks.append(task_id)
                self._save_state()
                return True
            else:
                logger.warning(f"⚠️ 结果上报失败: {response.status_code}")
                return False
        except Exception as e:
            logger.warning(f"⚠️ 结果上报异常: {e}")
            return False

    # ----------------------------------------------------------
    # Main Loop
    # ----------------------------------------------------------

    async def run(self):
        """主运行循环"""
        self.running = True
        logger.info("=" * 60)
        logger.info("🦀 ClawWork Local Workspace Agent 启动")
        logger.info(f"   代理 ID: {self.agent_id}")
        logger.info(f"   工作目录: {WORKSPACE_DIR}")
        logger.info(f"   云端地址: {self.api_base}")
        logger.info(f"   轮询间隔: {POLL_INTERVAL}s")
        logger.info("=" * 60)

        # Step 1: 检查云端连接
        connected = await self.check_cloud_connection()
        if not connected:
            logger.error("❌ 无法连接到云端，请检查网络或 Render 服务状态")
            logger.info("💡 提示: 确保 Render 服务 https://clawwork-iph9.onrender.com 正在运行")
            self.running = False
            return

        # Step 2: 注册本地代理
        registered = await self.register_agent()
        if not registered:
            logger.warning("⚠️ 代理注册失败（云端可能尚未实现 /api/local-agents 端点）")
            logger.info("💡 代理将以独立模式运行，仅执行本地任务")

        # Step 3: 初始文件同步
        logger.info("📁 执行初始文件扫描...")
        await self.sync_files_to_cloud()

        # Step 4: 主循环
        heartbeat_interval = 15
        heartbeat_counter = 0

        try:
            while self.running:
                await self.poll_tasks()

                while self._pending_tasks:
                    task = self._pending_tasks.pop(0)
                    result = await self.execute_task(task)
                    await self.report_task_result(result)

                await self.sync_files_to_cloud()

                heartbeat_counter += 1
                if heartbeat_counter >= heartbeat_interval // POLL_INTERVAL:
                    await self.send_heartbeat()
                    heartbeat_counter = 0

                await asyncio.sleep(POLL_INTERVAL)

        except asyncio.CancelledError:
            logger.info("🛑 代理收到停止信号")
        except Exception as e:
            logger.error(f"❌ 代理运行异常: {e}")
            import traceback
            traceback.print_exc()
        finally:
            self.running = False
            await self.cleanup()

    async def cleanup(self):
        """清理资源"""
        logger.info("🧹 清理资源...")
        if self._http_client and not self._http_client.is_closed:
            await self._http_client.aclose()
        logger.info("👋 代理已停止")


# ============================================================
# CLI Entry Point
# ============================================================

def print_status():
    """打印本地代理状态"""
    state_file = LOG_DIR / "state.json"
    log_file = LOG_DIR / "agent.log"

    print()
    print("=" * 50)
    print("🦀 ClawWork Local Agent Status")
    print("=" * 50)
    print(f"  工作目录: {WORKSPACE_DIR}")
    print(f"  云端地址: {RENDER_API_BASE}")
    print(f"  状态文件: {state_file}")
    print(f"  日志文件: {log_file}")
    print()

    if state_file.exists():
        try:
            data = json.loads(state_file.read_text(encoding="utf-8"))
            print(f"  文件哈希缓存: {len(data.get('file_hashes', {}))} 个")
            print(f"  已完成任务: {len(data.get('completed_tasks', []))} 个")
            print(f"  最后更新: {data.get('last_updated', 'N/A')}")
        except Exception as e:
            print(f"  ⚠️ 状态文件读取失败: {e}")
    else:
        print("  📭 状态文件不存在（代理尚未运行）")

    if log_file.exists():
        size = log_file.stat().st_size
        print(f"  日志大小: {size / 1024:.1f} KB")
    print()


async def run_daemon():
    """以守护进程模式运行代理"""
    agent = LocalWorkspaceAgent()
    await agent.run()


def main():
    """CLI 入口"""
    parser = argparse.ArgumentParser(
        description="ClawWork Local Workspace Agent - 连接 Render 云端与本地文件系统",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python local_agent.py              # 启动代理（交互模式）
  python local_agent.py --daemon     # 启动代理（守护进程模式）
  python local_agent.py --status     # 查看代理状态
  python local_agent.py --check      # 仅检查云端连接
        """,
    )
    parser.add_argument("--daemon", action="store_true", help="以守护进程模式运行")
    parser.add_argument("--status", action="store_true", help="查看代理状态")
    parser.add_argument("--check", action="store_true", help="仅检查云端连接")

    args = parser.parse_args()

    if args.status:
        print_status()
        return

    if args.check:
        async def check_only():
            agent = LocalWorkspaceAgent()
            connected = await agent.check_cloud_connection()
            if connected:
                print(f"\n✅ 成功连接到 {RENDER_API_BASE}")
            else:
                print(f"\n❌ 无法连接到 {RENDER_API_BASE}")
            if agent._http_client and not agent._http_client.is_closed:
                await agent._http_client.aclose()

        asyncio.run(check_only())
        return

    if args.daemon:
        print("🔄 以守护进程模式启动...")
        try:
            asyncio.run(run_daemon())
        except KeyboardInterrupt:
            print("\n\n👋 代理已停止")
    else:
        print()
        print("🦀 ClawWork Local Workspace Agent")
        print("=" * 50)
        print(f"  云端: {RENDER_API_BASE}")
        print(f"  目录: {WORKSPACE_DIR}")
        print(f"  端口: {LOCAL_AGENT_PORT}")
        print("=" * 50)
        print("  按 Ctrl+C 停止代理")
        print()

        try:
            asyncio.run(run_daemon())
        except KeyboardInterrupt:
            print("\n\n👋 代理已停止")


if __name__ == "__main__":
    main()
