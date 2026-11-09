FROM python:3.11-slim

# System libraries needed by OpenCV / ONNX Runtime (server-side OCR), and gosu for the entrypoint to drop root
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    gosu \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Full server dependencies including OCR (models are fetched once at build time, below)
COPY requirements-docker.txt .
RUN pip install --no-cache-dir -r requirements-docker.txt

# Application code
COPY server.py local_ocr.py default_rosters.py ./
COPY ffk_core/ ./ffk_core/
COPY ocr_engine/ ./ocr_engine/
COPY tools/backup.py ./tools/backup.py
COPY public/ ./public/

# Load the reader exactly as the server does (same tuning, so the same models) and read one image: every model it
# needs is downloaded and checked now, as root. The server runs as an unprivileged user that cannot write into
# site-packages, so a model fetched at runtime would fail with "Permission denied". Then make the models readable.
RUN python -c "import ocr_engine; ocr_engine.warm()" \
 && chmod -R a+rX "$(python -c 'import os, rapidocr; print(os.path.join(os.path.dirname(rapidocr.__file__), "models"))')"

# The server runs as an unprivileged user; /data is the persistent volume for the SQLite database. The image starts
# as root only so the entrypoint can take ownership of a root-owned mounted volume (Railway), then drops to "app".
RUN useradd --create-home --uid 10001 app && mkdir -p /data && chown app:app /data
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 755 /usr/local/bin/docker-entrypoint.sh
ENV DB_PATH=/data/war.sqlite3
ENV PORT=8080
ENV PYTHONUNBUFFERED=1

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import os,urllib.request;urllib.request.urlopen('http://127.0.0.1:%s/health'%os.environ.get('PORT','8080'),timeout=4)"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["python", "server.py"]
