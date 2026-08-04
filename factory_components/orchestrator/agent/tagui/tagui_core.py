import subprocess
import os


class TagUICore:
    def __init__(self):
        self.tagui_path = 'C:/tagui/tagui.cmd'

    def run_flow(self, flow_path):
        print(f'[TagUI] Running flow: {flow_path}')
        if not os.path.exists(self.tagui_path):
            print(f'[TagUI] WARNING: TagUI not installed at {self.tagui_path}; skipping real execution')
            return False
        subprocess.run([self.tagui_path, flow_path])
        return True

    def click(self, selector):
        flow = f'click {selector}'
        print(f'[TagUI] Click: {selector}')
        return flow

    def type(self, selector, text):
        flow = f'type {selector} "{text}"'
        print(f'[TagUI] Type: {selector} = {text}')
        return flow

    def open(self, url):
        flow = f'url {url}'
        print(f'[TagUI] Open URL: {url}')
        return flow
