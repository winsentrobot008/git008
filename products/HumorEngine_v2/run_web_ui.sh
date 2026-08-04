#!/usr/bin/env bash
# ================================================================
#  HumorEngine_v2 — One-Click Web UI Launcher (Unix / macOS)
# ================================================================
# Usage:
#   chmod +x run_web_ui.sh
#   ./run_web_ui.sh
#
# Or double-click the file in Finder (macOS).

set -e

clear

echo ""
echo " ================================================================"
echo "       __  __                        _____       _        ___"
echo "      |  \/  |                      |  __ \     | |      |__ \\"
echo "      | \  / |  _   _   _ __    ___ | |__) |   | |   ___   | |"
echo "      | |\/| | | | | | | '_ \  / _ \|  _  /   | |  / _ \  | |"
echo "      | |  | | | |_| | | | | ||  __/| | \ \   | | | (_) | | |"
echo "      |_|  |_|  \__,_| |_| |_| \___||_|  \_\  |_|  \___/ |___|"
echo " ================================================================"
echo "        High-Intellect Humor Generation — Web UI"
echo " ================================================================"
echo ""

# Determine script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo " [INFO] Checking Python environment..."

# Check if Python is available
if ! command -v python3 &>/dev/null && ! command -v python &>/dev/null; then
    echo " [ERROR] Python not found! Please install Python 3.10+ first."
    echo " [INFO]  Download from: https://www.python.org/downloads/"
    echo ""
    exit 1
fi

PYTHON="python3"
if ! command -v python3 &>/dev/null; then
    PYTHON="python"
fi

# Display Python version
$PYTHON --version

# Ensure required packages are installed
echo ""
echo " [INFO] Checking required packages..."
if ! $PYTHON -c "import gradio" 2>/dev/null; then
    echo " [INFO] Installing gradio..."
    pip install gradio
fi
if ! $PYTHON -c "import requests" 2>/dev/null; then
    echo " [INFO] Installing requests..."
    pip install requests
fi

echo ""
echo " [INFO] All dependencies satisfied."
echo ""
echo " [INFO] Starting HumorEngine_v2 Web UI server..."
echo " [INFO] Local URL: http://127.0.0.1:7860"
echo ""
echo " ================================================================"
echo "        Press Ctrl+C in this terminal to stop the server."
echo " ================================================================"
echo ""

# Launch the Web UI
$PYTHON src/web_ui.py

echo ""
echo " [INFO] Server stopped."
