FROM ghcr.io/home-assistant/base:latest

RUN apk add --no-cache \
    python3 \
    py3-pip

WORKDIR /tmp/solaroid
COPY pyproject.toml .
COPY src ./src

RUN pip install --break-system-packages --no-cache-dir .
WORKDIR /

COPY --chmod=755 ./run.sh /

CMD ["/run.sh"]
