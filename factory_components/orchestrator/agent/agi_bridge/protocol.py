class AGIProtocol:
    def send(self, message):
        print(f'[AGI-Bridge] Sending message: {message}')

    def receive(self):
        print('[AGI-Bridge] Receiving message')
        return {'task': 'dummy_task', 'payload': {}}
