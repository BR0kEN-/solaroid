#!/usr/bin/env bash

set -euo pipefail
source .env

CONTAINER_PATH="/config/www/solaroid"

npm run build:ha
tar -C dist -cf - . | ssh "$1" \
  "docker exec -i homeassistant sh -c 'rm -rf $CONTAINER_PATH && mkdir -p $CONTAINER_PATH && tar -C $CONTAINER_PATH -xf -'"
