# SikuliX Test Center

基于 SikuliX 的图像识别自动化测试中心，提供统一的 UI 自动化测试框架。

## 项目结构

```
sikulix-test-center/
├── assets/               # 图像资产库
│   ├── global/           # 通用 UI 图标（确认、取消、关闭等）
│   └── apps/             # 各应用专用图片资源
├── core/                 # 核心封装
│   ├── driver.py         # SikuliX API 基础封装 (Click, Find, Type)
│   └── config.py         # 全局配置（相似度阈值、超时等）
├── pages/                # Page Object 页面对象层
├── tests/                # 测试用例层
├── reports/              # 测试报告输出目录
├── requirements.txt      # 依赖包配置
└── README.md             # 项目说明文档
```

## 环境要求

- **Java Runtime Environment** (JRE 8+)
- **SikuliX IDE** 或 **SikuliX JAR**（[下载地址](https://sikulix.com/)）
- Python 3.8+
- 支持的操作系统：Windows / macOS / Linux

## 快速开始

1. **安装依赖**

   ```bash
   pip install -r requirements.txt
   ```

2. **配置 SikuliX**

   下载并安装 SikuliX，确保 `sikulixapi.jar` 可用或被项目引用。

3. **准备图像资产**

   将目标应用的 UI 截图放置到 `assets/apps/<应用名>/` 目录下。

4. **编写测试用例**

   ```python
   from core.driver import Driver
   from core.config import Config

   driver = Driver(Config(similarity=0.8))
   driver.click("apps/myapp/login_button.png")
   driver.type("admin", "apps/myapp/username_field.png")
   ```

5. **运行测试**

   ```bash
   pytest tests/ -v --html=reports/report.html
   ```

## 设计模式

本项目采用 **Page Object 设计模式**，将每个页面封装为一个独立的类，提高代码的可维护性和可读性。

```
tests/              # 测试用例（调用 Page Object）
  └── test_login.py
pages/              # 页面对象（封装元素定位和操作）
  └── login_page.py
core/               # 核心驱动（封装 SikuliX API）
  └── driver.py
```

## 最佳实践

1. **截图命名**：使用 `小写_下划线` 命名方式，如 `login_button.png`
2. **相似度阈值**：普通 UI 元素使用 0.7~0.8，动态内容可适当降低
3. **超时设置**：根据网络和应用响应速度合理调整超时时间
4. **日志记录**：使用 `loguru` 记录详细的操作日志，便于排查失败原因

## License

MIT
