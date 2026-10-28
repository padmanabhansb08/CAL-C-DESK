"""Shared rules: password hashing, first-run setup, login throttling, cookies, body limits."""
import hashlib
import hmac
import os
import secrets
import threading
import time

MAX_BODY = 2_000_000          # organizer state, login, host access
MAX_OCR_BODY = 14_000_000     # a screenshot as base64
SESSION_SECONDS = 43200       # twelve hours

FAILURES_BEFORE_LOCK = 5
LOCK_SECONDS = 600
WINDOW_SECONDS = 600
GLOBAL_FAILURES_PER_MINUTE = 40

_PROXY_HEADERS = ('x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'forwarded', 'x-real-ip',
                  'fly-client-ip', 'cf-connecting-ip', 'x-vercel-forwarded-for')


def hash_password(password):
    salt = secrets.token_hex(16)
    return salt + ':' + hashlib.scrypt(password.encode(), salt=salt.encode(), n=16384, r=8, p=1).hex()


def verify_password(password, stored):
    try:
        salt, expected = stored.split(':')
    except ValueError:
        return False
    actual = hashlib.scrypt(password.encode(), salt=salt.encode(), n=16384, r=8, p=1).hex()
    return hmac.compare_digest(actual, expected)


def _lower(headers):
    return {k.lower(): v for k, v in headers.items()}


def via_proxy(headers):
    h = _lower(headers)
    return any(name in h for name in _PROXY_HEADERS)


def client_ip(headers, peer):
    """The caller's address. Forwarded headers are only consulted when present (a proxy added them)."""
    h = _lower(headers)
    for name in ('fly-client-ip', 'cf-connecting-ip', 'x-real-ip'):
        if h.get(name):
            return h[name].split(',')[0].strip()
    if h.get('x-forwarded-for'):
        return h['x-forwarded-for'].split(',')[0].strip()
    return peer or 'unknown'


def is_https(headers):
    h = _lower(headers)
    return h.get('x-forwarded-proto', '').split(',')[0].strip() == 'https' or os.environ.get('COOKIE_SECURE') == '1'


def session_cookie(token, headers, max_age=SESSION_SECONDS):
    flags = 'HttpOnly; SameSite=Strict; Path=/; Max-Age=%d' % max_age
    if is_https(headers):
        flags += '; Secure'
    return f'ffk={token}; {flags}'


def setup_allowed(headers, supplied_token):
    """May this request create the first organizer password?

    Direct requests (localhost or the home network) may. Requests that came through a
    reverse proxy, which is how every public host reaches the app, need SETUP_TOKEN so a
    stranger who finds the URL first cannot claim the account.
    Returns (allowed, message).
    """
    token = os.environ.get('SETUP_TOKEN', '')
    if token:
        if hmac.compare_digest(str(supplied_token or ''), token):
            return True, ''
        return False, 'Enter the setup token from the server settings to create the organizer password.'
    if via_proxy(headers):
        return False, ('First-time setup over a public address needs a SETUP_TOKEN. '
                       'Set the SETUP_TOKEN environment variable on the server, then enter it here.')
    return True, ''


def setup_requires_token(headers):
    return bool(os.environ.get('SETUP_TOKEN')) or via_proxy(headers)


def body_limit(path):
    return MAX_OCR_BODY if path in ('/api/ocr', '/api/ocr/scan') else MAX_BODY


def parse_content_length(value, path):
    """Return (size, error). A missing, negative or oversized length is refused before any read."""
    try:
        size = int(value if value is not None else 0)
    except (TypeError, ValueError):
        return 0, 'Invalid request'
    if size < 0:
        return 0, 'Invalid request'
    if size > body_limit(path):
        return 0, 'Request too large'
    return size, None


class Throttle:
    """Per-address lockout plus a global ceiling, in memory (single-process server)."""

    def __init__(self):
        self._lock = threading.Lock()
        self._by_ip = {}
        self._recent = []

    def retry_after(self, ip, now=None):
        now = now or time.time()
        with self._lock:
            entry = self._by_ip.get(ip)
            wait = max(0, int(entry['locked_until'] - now)) if entry else 0
            self._recent = [t for t in self._recent if now - t < 60]
            if len(self._recent) >= GLOBAL_FAILURES_PER_MINUTE:
                wait = max(wait, 60)
            return wait

    def failed(self, ip, now=None):
        now = now or time.time()
        with self._lock:
            entry = self._by_ip.setdefault(ip, {'count': 0, 'start': now, 'locked_until': 0})
            if now - entry['start'] > WINDOW_SECONDS:
                entry.update(count=0, start=now)
            entry['count'] += 1
            if entry['count'] >= FAILURES_BEFORE_LOCK:
                entry['locked_until'] = now + LOCK_SECONDS
                entry['count'] = 0
            self._recent.append(now)
            if len(self._by_ip) > 5000:
                self._by_ip = {k: v for k, v in self._by_ip.items() if v['locked_until'] > now}

    def succeeded(self, ip):
        with self._lock:
            self._by_ip.pop(ip, None)
