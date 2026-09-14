FROM python:3.12-slim

RUN python -m pip install --no-cache-dir uv==0.11.23 \
    && useradd --create-home --uid 1000 sentry

USER sentry
WORKDIR /home/sentry/app
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    SENTRY_HOST=0.0.0.0 \
    PORT=7860 \
    UV_LINK_MODE=copy \
    UV_CACHE_DIR=/tmp/sentry-uv-cache

COPY --chown=sentry:sentry . .
RUN uv sync --frozen --no-dev

EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
    CMD [".venv/bin/python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:7860/api/health', timeout=4)"]
CMD [".venv/bin/python", "app.py"]
