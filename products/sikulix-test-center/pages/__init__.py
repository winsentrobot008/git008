# SikuliX Test Center - Page Objects Module
# 页面对象层，遵循 Page Object 设计模式

"""
页面对象模块

使用 Page Object 模式封装各个应用界面的元素定位和交互操作。
每个 Page 类对应一个应用界面，封装该界面上所有可操作的 UI 元素。

用法示例:
    from pages.login_page import LoginPage

    login = LoginPage(driver)
    login.input_username("admin")
    login.input_password("123456")
    login.click_login()
"""

from .base_page import BasePage

__all__ = ["BasePage"]
