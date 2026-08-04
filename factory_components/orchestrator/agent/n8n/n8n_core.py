class N8NCore:
    def execute(self, task):
        print(f'[n8n] Executing workflow for task: {task}')
        return {'status': 'ok', 'task': task}
