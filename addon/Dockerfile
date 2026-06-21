FROM ghcr.io/home-assistant/base:latest

RUN apk add --no-cache \
    python3 \
    py3-pip \
    py3-requests

COPY app /app
COPY --chmod=755 ./run.sh /

CMD ["/run.sh"]
