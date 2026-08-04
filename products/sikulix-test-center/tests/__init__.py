# SikuliX Test Center - Test Cases Module
# 测试用例层，存放所有自动化测试用例

"""
测试用例模块

使用 unittest 或 pytest 框架编写的自动化测试用例。
测试用例通过 Driver 和 Page Object 与 UI 进行交互。

目录结构建议:
    tests/
    ├── __init__.py
    ├── test_login.py          # 登录相关测试
    ├── test_dashboard.py      # 仪表盘相关测试
    └── suites/
        └── smoke_test.py      # 冒烟测试套件
"""
