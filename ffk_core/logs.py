"""One-line, greppable logs to stdout (what Docker, Render and Fly collect)."""
import logging
import os
import sys

log = logging.getLogger('ffk')


def setup():
    if log.handlers:
        return log
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(message)s', '%Y-%m-%dT%H:%M:%S'))
    log.addHandler(handler)
    log.setLevel(os.environ.get('LOG_LEVEL', 'INFO').upper())
    log.propagate = False
    return log
