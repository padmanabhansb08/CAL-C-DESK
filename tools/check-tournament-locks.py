"""Check qualification locks on a temporary database, preserving real events."""
import http.client
import gc
import json
from pathlib import Path
import sys
import tempfile
import threading
import time

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import server

with tempfile.TemporaryDirectory() as folder:
    server.DB = Path(folder) / 'war-test.sqlite3'
    original = {'teams': [], 'matches': [{'id': 'a1', 'stage': 'A', 'rows': []}],
                'war': {'groups': {'A': ['t1'], 'B': []},
                        'qualified': {'A': ['t1'], 'C': ['t1']}, 'cs': {'final': {'winner': 't1'}}}}
    server.put('state', json.dumps(original))
    server.session_create('test', time.time() + 60)
    host = server.WarDeskServer(('127.0.0.1', 0), server.Handler)
    threading.Thread(target=host.serve_forever, daemon=True).start()
    def post(path, payload):
        connection = http.client.HTTPConnection('127.0.0.1', host.server_port)
        connection.request('POST', '/api/' + path, json.dumps(payload),
                           {'Content-Type': 'application/json', 'Cookie': 'ffk=test'})
        response = connection.getresponse()
        status = response.status
        response.read()
        connection.close()
        return status
    try:
        assert post('matches/delete', {'id': 'a1'}) == 409
        changed = json.loads(json.dumps(original))
        changed['matches'][0]['rows'] = [{'total': 100}]
        assert post('state', changed) == 409
        changed = json.loads(json.dumps(original))
        changed['war']['qualified']['A'] = ['t2']
        assert post('state', changed) == 409
        changed['war']['qualified'].pop('A')
        assert post('state', changed) == 409
        changed['war']['qualified'].pop('C')
        changed['war']['cs'] = {}
        assert post('state', changed) == 200
        assert post('matches/delete', {'id': 'a1'}) == 200
        print('PASS: locked result edits, qualifier changes and deletion blocked; reopening clears dependencies and permits corrections.')
    finally:
        host.shutdown()
        host.server_close()
        gc.collect()
