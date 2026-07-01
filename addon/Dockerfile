FROM ghcr.io/home-assistant/base:latest

RUN apk add --no-cache \
    python3 \
    py3-pip

COPY app /app
COPY pyproject.toml /app/pyproject.toml
WORKDIR /app
RUN pip install --break-system-packages --no-cache-dir .
COPY --chmod=755 ./run.sh /

CMD ["/run.sh"]
