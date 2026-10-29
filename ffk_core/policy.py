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


def trusted_hops():
    """How many reverse proxies sit in front of this server (TRUST_PROXY, default 0).

    Forwarded headers are client-controlled unless a proxy you run overwrites them, so they are
    ignored unless the operator says how many proxies to trust. Vercel always has one.
    """
    raw = os.environ.get('TRUST_PROXY', '').strip().lower()
    if raw in ('1', 'true', 'yes', 'on'):
        return 1
    if raw.isdigit():
        return int(raw)
    return 1 if os.environ.get('VERCEL') else 0


def client_ip(headers, peer):
    """The caller's address, for lockouts and rate limits.

    With no trusted proxy this is the TCP peer, so a header such as X-Forwarded-For cannot be used to
    dodge a lockout. With TRUST_PROXY=N the Nth entry from the right of X-Forwarded-For is used, which is
    the address the outermost trusted proxy saw; entries to its left are client-supplied and ignored.
    """
    hops = trusted_hops()
    if hops <= 0:
        return peer or 'unknown'
    h = _lower(headers)
    if os.environ.get('FLY_APP_NAME') and h.get('fly-client-ip'):
        return h['fly-client-ip'].strip()
    chain = [p.strip() for p in h.get('x-forwarded-for', '').split(',') if p.strip()]
    if len(chain) >= hops:
        return chain[-hops]
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


class RateLimiter:
    """Sliding-window request limiter, per key (single-process, in memory)."""

    def __init__(self):
        self._lock = threading.Lock()
        self._hits = {}

    def allow(self, key, limit, per=60.0, now=None):
        now = now or time.time()
        with self._lock:
            hits = [t for t in self._hits.get(key, ()) if now - t < per]
            if len(hits) >= limit:
                self._hits[key] = hits
                return False
            hits.append(now)
            self._hits[key] = hits
            if len(self._hits) > 20000:
                self._hits = {k: v for k, v in self._hits.items() if v and now - v[-1] < per}
            return True


API_PER_MINUTE = 240      # any /api request from one address
SCAN_PER_MINUTE = 12      # screenshot reads from one address


def rate_limited(limiter, ip, path):
    """True if this request should be refused with 429."""
    if not path.startswith('/api/'):
        return False
    if path in ('/api/ocr', '/api/ocr/scan') and not limiter.allow((ip, 'scan'), SCAN_PER_MINUTE):
        return True
    return not limiter.allow((ip, 'api'), API_PER_MINUTE)


def hash_token(token):
    """Session tokens are stored hashed so a leaked database cannot be replayed as cookies."""
    return hashlib.sha256(str(token).encode()).hexdigest()


def security_headers(headers):
    """Response headers for every page and API reply. Returns a list of (name, value)."""
    csp = ("default-src 'self'; "
           # The app builds markup with inline handlers, so inline scripts stay allowed for now; everything
           # else (framing, plugins, <base> injection, form hijacking, foreign scripts) is closed.
           "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net; "
           "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
           "font-src 'self' https://fonts.gstatic.com data:; "
           "img-src 'self' data: blob:; "
           "connect-src 'self' https://cdn.jsdelivr.net https://tessdata.projectnaptha.com; "
           "worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'")
    name = ('Content-Security-Policy-Report-Only' if os.environ.get('CSP_REPORT_ONLY') == '1'
            else 'Content-Security-Policy')
    out = [(name, csp), ('X-Content-Type-Options', 'nosniff'), ('X-Frame-Options', 'DENY'),
           ('Referrer-Policy', 'no-referrer'), ('Permissions-Policy', 'camera=(), microphone=(), geolocation=()'),
           ('Cross-Origin-Opener-Policy', 'same-origin')]
    if is_https(headers):
        out.append(('Strict-Transport-Security', 'max-age=31536000; includeSubDomains'))
    return out


def host_view(current):
    """Read-only data for the host desk: results plus the tournament progress needed to follow stages."""
    war = current.get('war') or {}
    return {'teams': current.get('teams', []), 'matches': current.get('matches', []),
            'war': {k: war[k] for k in ('groups', 'qualified', 'targets', 'cs', 'csFormat') if k in war}}
