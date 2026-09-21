FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    SHIPPING_DATA_ROOT=/app/data_v2 \
    PORT=10000

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY agents ./agents
COPY scripts ./scripts
COPY data_v2 ./data_v2

RUN mkdir -p /app/.artifacts/uploads /app/data_v2/inbox /app/data_v2/attachments

EXPOSE 10000

CMD ["sh", "-c", "uvicorn agents.shipping.api:create_app --factory --host 0.0.0.0 --port ${PORT}"]