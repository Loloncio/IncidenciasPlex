FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY notificacion_correo.py .

RUN useradd --create-home --uid 1000 notifier
USER notifier

CMD ["python", "notificacion_correo.py"]
