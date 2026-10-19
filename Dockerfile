FROM python:3.11-slim

# Install system libraries needed by OpenCV / ONNX if server-side OCR is used
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install optional server OCR dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY server.py local_ocr.py ./
COPY public/ ./public/

# Directory for SQLite database volume
RUN mkdir -p /data
ENV DB_PATH=/data/war.sqlite3
ENV PORT=8080

EXPOSE 8080

CMD ["python", "server.py"]
