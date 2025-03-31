#!/bin/bash

# Build the Docker image
docker build -t octopus-tado-sync .

# Run the container with environment variables
docker run --rm octopus-tado-sync \
  --tado-email "$TADO_EMAIL" \
  --tado-password "$TADO_PASSWORD" \
  --tado-client-secret "$TADO_CLIENT_SECRET" \
  --mprn "$MPRN" \
  --gas-serial-number "$GAS_SERIAL_NUMBER" \
  --octopus-api-key "$OCTOPUS_API_KEY" 