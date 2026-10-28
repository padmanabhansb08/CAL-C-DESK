FROM python:3.11-slim

# System libraries needed by OpenCV / ONNX Runtime (server-side OCR)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Full server dependencies including OCR (RapidOCR ships its own models, no download at runtime)
COPY requirements-docker.txt .
RUN pip install --no-cache-dir -r requirements-docker.txt

# Application code
COPY server.py local_ocr.py default_rosters.py ./
COPY ffk_core/ ./ffk_core/
COPY ocr_engine/ ./ocr_engine/
COPY public/ ./public/

# Run as an unprivileged user; /data is the persistent volume for the SQLite database
RUN useradd --create-home --uid 10001 app && mkdir -p /data && chown app:app /data
USER app
ENV DB_PATH=/data/war.sqlite3
ENV PORT=8080

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import os,urllib.request;urllib.request.urlopen('http://127.0.0.1:%s/health'%os.environ.get('PORT','8080'),timeout=4)"

CMD ["python", "server.py"]
