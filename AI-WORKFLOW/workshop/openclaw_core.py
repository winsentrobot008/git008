"""
OpenClaw - Core Logic
Provides CLI command generation, execution, and output capture.
"""

import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path


class OpenClawExecutor:
    """OpenClaw Executor: Generates and executes CLI commands."""

    def __init__(self, workspace_root: str = None):
        self.workspace_root = workspace_root or os.getcwd()
        self.logs_dir = os.path.join(self.workspace_root, "logs")
        os.makedirs(self.logs_dir, exist_ok=True)

    def generate_command(self, action: str, target: str = None) -> str:
        """Generate a CLI command based on action and target."""
        command_map = {
            "deploy": f"python {os.path.join(self.workspace_root, 'scripts', 'trigger_deploy.py')}",
            "build": f"python {os.path.join(self.workspace_root, 'app.py')}",
            "test": f"python -m pytest {os.path.join(self.workspace_root, 'agent_engine', 'tests')}",
            "start": f"python {os.path.join(self.workspace_root, 'start_factory.py')}",
            "analyze": f"python {os.path.join(self.workspace_root, 'analyst', 'strategist_agent.py')}",
            "scan": f"python {os.path.join(self.workspace_root, 'radar', 'tavily_client.py')}",
            "report": f"python {os.path.join(self.workspace_root, 'warroom', 'report_generator.py')}",
        }
        if target and target in command_map:
            return command_map[target]
        return command_map.get(action, f"echo 'Unknown action: {action}'")

    def execute(self, command: str, cwd: str = None) -> dict:
        """Execute a CLI command and capture output."""
        cwd = cwd or self.workspace_root
        try:
            result = subprocess.run(
                command,
                shell=True,
                capture_output=True,
                text=True,
                cwd=cwd,
                timeout=300,
            )
            return {
                "command": command,
                "returncode": result.returncode,
                "stdout": result.stdout,
                "stderr": result.stderr,
                "success": result.returncode == 0,
                "timestamp": datetime.utcnow().isoformat(),
            }
        except subprocess.TimeoutExpired:
            return {
                "command": command,
                "returncode": -1,
                "stdout": "",
                "stderr": "Command timed out after 300 seconds",
                "success": False,
                "timestamp": datetime.utcnow().isoformat(),
            }
        except Exception as e:
            return {
                "command": command,
                "returncode": -1,
                "stdout": "",
                "stderr": str(e),
                "success": False,
                "timestamp": datetime.utcnow().isoformat(),
            }

    def run_pipeline(self, commands: list[str]) -> list[dict]:
        """Run a pipeline of commands sequentially."""
        results = []
        for cmd in commands:
            result = self.execute(cmd)
            results.append(result)
            if not result["success"]:
                break
        return results
