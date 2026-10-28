"""Check deletion against a temporary database; never modify organizer results."""
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
    server.DB = Path(folder) / 'test.sqlite3'
    original = {'teams': [{'id': 'keep-team', 'name': 'Preserved team'}],
                'matches': [{'id': 'first', 'name': 'First'}, {'id': 'second', 'name': 'Second'}]}
    server.put('state', json.dumps(original))
    server.session_create('test-token', time.time() + 60)
    host = server.WarDeskServer(('127.0.0.1', 0), server.Handler)
    try:
        duplicate = server.WarDeskServer(('127.0.0.1', host.server_port), server.Handler)
    except OSError:
        pass
    else:
        duplicate.server_close()
        raise AssertionError('A second server must not share the same port')
    thread = threading.Thread(target=host.serve_forever, daemon=True)
    thread.start()
    def request(payload, authenticated=True):
        connection = http.client.HTTPConnection('127.0.0.1', host.server_port)
        headers = {'Content-Type': 'application/json'}
        if authenticated:
            headers['Cookie'] = 'ffk=test-token'
        connection.request('POST', '/api/matches/delete', json.dumps(payload), headers)
        response = connection.getresponse()
        result = response.status, json.loads(response.read())
        connection.close()
        return result
    try:
        assert request({'id': 'first'}, False)[0] == 401
        assert request({'id': ''})[0] == 400
        assert request({'id': 'absent'})[0] == 404
        assert json.loads(server.get('state')) == original
        status, state = request({'id': 'first'})
        assert status == 200 and state['teams'] == original['teams']
        assert state['matches'] == [original['matches'][1]]
        assert request({'id': 'first'})[0] == 404
        assert request({'id': 'second'})[1] == {'teams': original['teams'], 'matches': []}
        assert json.loads(server.get('state')) == {'teams': original['teams'], 'matches': []}
        print('PASS: authenticated targeted deletion, invalid/missing IDs, roster preservation and last-match deletion.')
    finally:
        host.shutdown()
        host.server_close()
        thread.join()
        gc.collect()  # Release SQLite connection cycles before Windows removes the temporary file.
