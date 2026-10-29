"""Optional CPU OCR comparison. Images never leave this server."""
import base64
from io import BytesIO
from pathlib import Path
import sys
import threading

RUNTIME = Path(__file__).parent / '.ocr-runtime'
_engine = None
_lock = threading.Lock()

def available():
    if (RUNTIME / 'rapidocr').exists():
        return True
    try:
        import rapidocr  # noqa: F401
        return True
    except ImportError:
        return False

def recognize(image, boxes):
    global _engine
    if not available():
        raise ValueError('Local comparison engine is not installed.')
    if len(boxes) > 100:
        raise ValueError('Too many text regions.')
    if (RUNTIME / 'rapidocr').exists() and str(RUNTIME) not in sys.path:
        sys.path.insert(0, str(RUNTIME))
    import numpy as np
    import cv2
    from PIL import Image
    from rapidocr import RapidOCR
    raw = base64.b64decode(image.split(',', 1)[-1], validate=True)
    pil = Image.open(BytesIO(raw))
    if pil.width * pil.height > 6_000_000 or max(pil.width, pil.height) > 6000:
        raise ValueError('Screenshot is too large.')
    rgb = np.asarray(pil.convert('RGB'))
    output = []
    with _lock:
        if _engine is None:
            _engine = RapidOCR()
        for index, box in enumerate(boxes):
            x, y, w, h = [int(v) for v in box]
            if min(x, y) < 0 or min(w, h) < 1 or x+w > pil.width or y+h > pil.height:
                raise ValueError('Text region is outside the screenshot.')
            # RapidOCR uses BGR arrays. Bypass detection: the app already located the field.
            crop = rgb[y:y+h, x:x+w].copy()
            if index % 2 == 1:
                # Isolate the yellow numeral; white "Eliminations" fragments are not digits.
                r, g, b = [crop[:, :, i].astype(np.int16) for i in range(3)]
                mask = (r > 145) & (g > 115) & (r-b > 65) & (g-b > 50)
                ys, xs = np.where(mask)
                if len(xs) < 5:
                    output.append({'text': '', 'confidence': 0})
                    continue
                mono = np.where(mask, 0, 255).astype(np.uint8)
                mono = mono[ys.min():ys.max()+1, xs.min():xs.max()+1]
                mono = cv2.resize(mono, None, fx=4, fy=4, interpolation=cv2.INTER_CUBIC)
                mono = cv2.copyMakeBorder(mono, 12, 12, 12, 12, cv2.BORDER_CONSTANT, value=255)
                crop = cv2.cvtColor(mono, cv2.COLOR_GRAY2RGB)
            result = _engine(crop[:, :, ::-1].copy(), use_det=False, use_cls=False, use_rec=True)
            texts = list(result.txts) if result.txts is not None else []
            scores = list(result.scores) if result.scores is not None else []
            output.append({'text': str(texts[0]) if texts else '', 'confidence': float(scores[0]) if scores else 0})
    return output
