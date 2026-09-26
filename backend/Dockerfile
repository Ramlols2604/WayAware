FROM python:3.12-slim

WORKDIR /app

COPY pyproject.toml ./
COPY app ./app

# Runtime dependencies only -- the "dev" extra (ruff, pytest) is not installed.
RUN pip install --no-cache-dir .

# DigitalOcean App Platform expects the container to listen on 0.0.0.0:8080
# by default; $PORT is honored if the platform overrides it.
EXPOSE 8080

# exec form so uvicorn is PID 1 and receives SIGTERM directly for graceful
# shutdown, instead of a shell swallowing the signal.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
