FROM python:3.13.2-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY sync_octopus_tado.py .

ENTRYPOINT ["python", "sync_octopus_tado.py"] 