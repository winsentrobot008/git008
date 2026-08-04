# -*- coding: utf-8 -*-
"""
VOICE22 - 配置文件
"""
import os

# 基础路径
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS_DIR = os.path.join(BASE_DIR, "assets")
OUTPUT_DIR = os.path.join(BASE_DIR, "output")
TEMP_DIR = os.path.join(BASE_DIR, "temp")
LOGS_DIR = os.path.join(BASE_DIR, "logs")

# 确保必要目录存在
for folder in [OUTPUT_DIR, TEMP_DIR, LOGS_DIR, 
               os.path.join(ASSETS_DIR, "voices"), 
               os.path.join(ASSETS_DIR, "scripts")]:
    os.makedirs(folder, exist_ok=True)

# 运行模式：True 为模拟模式（生成占位音频），False 为真实 TTS 模式
SIMULATE_MODE = True

# 角色音色配置
VOICE_A_DESC = "成熟稳重的男声老板音色"
VOICE_B_DESC = "年轻活泼的男声员工音色"

# 语速微调 (1.0 为正常，建议 1.05 - 1.1 增加喜剧效果)
SPEED = 1.08

# 默认参考音频路径
VOICE_A_REF = os.path.join(ASSETS_DIR, "voices", "voice_A_ref.wav")
VOICE_B_REF = os.path.join(ASSETS_DIR, "voices", "voice_B_ref.wav")
SCRIPT_PATH = os.path.join(ASSETS_DIR, "scripts", "script.txt")
