import requests
import os


class HuginnEvents:
    def monitor_file(self, path):
        print(f'[Huginn] Monitoring file: {path}')
        return os.path.exists(path)

    def monitor_web(self, url):
        print(f'[Huginn] Checking webpage: {url}')
        try:
            r = requests.get(url)
            return r.status_code
        except:
            return None

    def trigger(self, event_name):
        print(f'[Huginn] Trigger event: {event_name}')
