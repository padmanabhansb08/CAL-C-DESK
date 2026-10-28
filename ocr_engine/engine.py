"""RapidOCR wrapper: full-page detection plus independent re-reads of small digits."""
from io import BytesIO
import re
import threading

_engine = None
_lock = threading.Lock()
MAX_PIXELS = 12_000_000
MIN_WORKING_WIDTH = 1500
MAX_WORKING_WIDTH = 2000


def available():
    try:
        import rapidocr  # noqa: F401
        import numpy, cv2, PIL  # noqa: F401
        return True
    except ImportError:
        return False


def _get_engine():
    global _engine
    if _engine is None:
        from rapidocr import RapidOCR
        _engine = RapidOCR()
    return _engine


class Word:
    __slots__ = ('text', 'conf', 'x0', 'y0', 'x1', 'y1')

    def __init__(self, text, conf, box):
        xs = [p[0] for p in box]
        ys = [p[1] for p in box]
        self.text, self.conf = text, float(conf)
        self.x0, self.y0, self.x1, self.y1 = min(xs), min(ys), max(xs), max(ys)

    @property
    def cx(self):
        return (self.x0 + self.x1) / 2

    @property
    def cy(self):
        return (self.y0 + self.y1) / 2

    @property
    def h(self):
        return self.y1 - self.y0

    @property
    def w(self):
        return self.x1 - self.x0

    def __repr__(self):
        return f'Word({self.text!r}, {self.conf:.2f}, x={self.x0:.0f}-{self.x1:.0f}, y={self.y0:.0f}-{self.y1:.0f})'


class Page:
    def __init__(self, rgb, words, width, height, scale=1.0):
        # rgb/words/width/height are in working pixels; scale = working / original.
        self.rgb, self.words, self.width, self.height, self.scale = rgb, words, width, height, scale


def load_image(image_bytes):
    import numpy as np
    from PIL import Image
    pil = Image.open(BytesIO(image_bytes))
    if pil.width * pil.height > MAX_PIXELS:
        raise ValueError('Screenshot is too large.')
    return np.asarray(pil.convert('RGB'))


def read_page(image_bytes):
    """Detect and recognise every text word, with word-level boxes."""
    rgb = load_image(image_bytes)
    scale = 1.0
    if rgb.shape[1] < MIN_WORKING_WIDTH or rgb.shape[1] > MAX_WORKING_WIDTH:
        # Enlarge small screenshots (the detector needs usable glyphs) and shrink huge ones
        # (it was tuned for ordinary screen sizes); positions are mapped back afterwards.
        import cv2
        target = MIN_WORKING_WIDTH if rgb.shape[1] < MIN_WORKING_WIDTH else MAX_WORKING_WIDTH
        scale = target / rgb.shape[1]
        rgb = cv2.resize(rgb, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC if scale > 1 else cv2.INTER_AREA)
    height, width = rgb.shape[:2]
    with _lock:
        result = _get_engine()(rgb[:, :, ::-1].copy(), use_det=True, use_cls=True, use_rec=True, return_word_box=True)
    words = []
    lines = result.word_results or []
    if lines and all(isinstance(line, tuple) and all(isinstance(i, tuple) for i in line) for line in lines):
        for line in lines:
            for text, conf, box in line:
                if text and text.strip():
                    words.append(Word(text.strip(), conf, box))
    else:
        # Word boxes were unavailable for at least one line: split each line by spaces instead.
        for box, text, conf in zip(result.boxes if result.boxes is not None else [], result.txts or [], result.scores or []):
            words.extend(_split_line(text, conf, box))
    return Page(rgb, words, width, height, scale)


def _split_line(text, conf, box):
    """Distribute a recognised line over its box, one word per whitespace-separated token."""
    xs = [p[0] for p in box]
    ys = [p[1] for p in box]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    total = max(1, len(text))
    out, pos = [], 0
    for token in re.split(r'(\s+)', text):
        if token and not token.isspace():
            a = x0 + (x1 - x0) * pos / total
            b = x0 + (x1 - x0) * (pos + len(token)) / total
            out.append(Word(token, conf, [(a, y0), (b, y0), (b, y1), (a, y1)]))
        pos += len(token)
    return out


def _variants(crop, border=(16, 16)):
    """Independent views of the same crop: raw, contrast-stretched, inverted, replicate-padded."""
    import cv2
    big = cv2.resize(crop, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
    gray = cv2.cvtColor(big, cv2.COLOR_RGB2GRAY)
    stretched = cv2.normalize(gray, None, 0, 255, cv2.NORM_MINMAX)
    inverted = 255 - stretched
    v, h = border

    def pad(img):
        return cv2.copyMakeBorder(img, v, v, h, h, cv2.BORDER_REPLICATE)
    return [
        ('raw', pad(big)),
        ('contrast', pad(cv2.cvtColor(stretched, cv2.COLOR_GRAY2RGB))),
        ('inverted', pad(cv2.cvtColor(inverted, cv2.COLOR_GRAY2RGB))),
        ('sharp', pad(cv2.filter2D(big, -1, __import__('numpy').array([[0, -1, 0], [-1, 5, -1], [0, -1, 0]], dtype='float32')))),
    ]


_CONFUSIONS = {'O': '0', 'o': '0', 'D': '0', 'Q': '0', 'I': '1', 'l': '1', '|': '1', 'i': '1'}
_LEAD = re.compile(r'^\s*([0-9OoDQIl|i]{1,2})\s*(?=[Ee3][Ll1I|]|$)')


def read_label_numbers(page, region, pad=3, views=None):
    """Re-read "N Eliminations" as a whole line, several ways, and pull out N.

    Reading the digit together with its label gives the recogniser context; an
    isolated crop of a thin "1" is far less reliable than the full phrase.
    Returns a list of (digits_or_None, confidence, view_name).
    """
    x0, y0, x1, y1 = region
    x0 = max(0, int(x0) - pad)
    y0 = max(0, int(y0) - pad)
    x1 = min(page.width, int(x1) + pad)
    y1 = min(page.height, int(y1) + pad)
    if x1 - x0 < 6 or y1 - y0 < 6:
        return []
    crop = page.rgb[y0:y1, x0:x1].copy()
    reads = []
    with _lock:
        engine = _get_engine()
        for name, image in _variants(crop):
            if views and name not in views:
                continue
            try:
                out = engine(image[:, :, ::-1].copy(), use_det=False, use_cls=False, use_rec=True, return_word_box=False)
            except Exception:
                continue
            texts = list(out.txts) if out.txts is not None else []
            scores = list(out.scores) if out.scores is not None else []
            text = texts[0] if texts else ''
            conf = float(scores[0]) if scores else 0.0
            m = _LEAD.match(text)
            if not m:
                reads.append((None, conf, name))
                continue
            raw = m.group(1)
            mapped = ''.join(_CONFUSIONS.get(c, c) for c in raw)
            # A letter that had to be mapped to a digit is weaker evidence than a clean digit.
            reads.append((mapped, conf * (1.0 if mapped == raw else 0.8), name))
    return reads


_ISO = re.compile(r'^\s*([0-9OoDQIl|i]{1,2})\s*$')


def read_isolated_digits(page, region, pad=2, views=None):
    """Read just the number glyphs inside region, with replicate-padding around the crop.

    Independent of the context read: it cannot be fooled by the label text, and
    it recovers digits the page-level detector dropped (for example a thin 1
    partly hidden by the mouse cursor).
    """
    import cv2
    x0, y0, x1, y1 = region
    x0 = max(0, int(x0) - pad)
    y0 = max(0, int(y0) - 2)
    x1 = min(page.width, int(x1))
    y1 = min(page.height, int(y1) + 2)
    if x1 - x0 < 4 or y1 - y0 < 6:
        return []
    crop = page.rgb[y0:y1, x0:x1].copy()
    reads = []
    with _lock:
        engine = _get_engine()
        for name, image in _variants(crop, border=(20, 40)):
            if views and name not in views:
                continue
            try:
                out = engine(image[:, :, ::-1].copy(), use_det=False, use_cls=False, use_rec=True, return_word_box=False)
            except Exception:
                continue
            texts = list(out.txts) if out.txts is not None else []
            scores = list(out.scores) if out.scores is not None else []
            text = texts[0] if texts else ''
            conf = float(scores[0]) if scores else 0.0
            m = _ISO.match(text)
            if not m:
                reads.append((None, conf, 'iso-' + name))
                continue
            raw = m.group(1)
            mapped = ''.join(_CONFUSIONS.get(c, c) for c in raw)
            reads.append((mapped, conf * (1.0 if mapped == raw else 0.8), 'iso-' + name))
    return reads
