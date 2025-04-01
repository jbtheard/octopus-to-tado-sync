# Octopus to Tado Sync

This repository contains a script to automatically sync your Octopus Energy smart meter readings with Tado. The workflow provided allows you to set this up to run on a daily basis using GitHub Actions.

## Prerequisites

- [Bun](https://bun.sh) installed on your system
- Octopus Energy API key
- Tado account credentials
- GitHub account (for automated syncing)

## Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/jbtheard/octopus-to-tado-sync.git
   cd octopus-to-tado-sync
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

3. Create a `.env` file based on the example:
   ```bash
   cp .env.example .env
   ```

4. Fill in your credentials in the `.env` file:
   ```env
   # Octopus Energy API credentials
   OCTOPUS_API_KEY=your_api_key_here
   MPRN=your_mprn_here
   GAS_SERIAL_NUMBER=your_serial_number_here

   # Tado credentials (optional, for automated authentication)
   TADO_USERNAME=your_tado_email
   TADO_PASSWORD=your_tado_password
   ```

## Usage

### Local Development

Run the script with automatic reloading:
```bash
bun dev -- --mprn "$MPRN" --gas-serial-number "$GAS_SERIAL_NUMBER" --octopus-api-key "$OCTOPUS_API_KEY"
```

### Production

Run the script once:
```bash
bun start -- --mprn "$MPRN" --gas-serial-number "$GAS_SERIAL_NUMBER" --octopus-api-key "$OCTOPUS_API_KEY"
```

### GitHub Actions Automation

1. First, run the script locally to obtain a refresh token:
   ```bash
   bun start -- \
     --mprn "$MPRN" \
     --gas-serial-number "$GAS_SERIAL_NUMBER" \
     --octopus-api-key "$OCTOPUS_API_KEY" \
     --tado-username "$TADO_USERNAME" \
     --tado-password "$TADO_PASSWORD"
   ```

2. The script will automatically:
   - Launch a headless browser
   - Log in to your Tado account
   - Complete the device verification
   - Save the refresh token to GitHub secrets

3. The GitHub Actions workflow will run daily at midnight and:
   - Use the stored refresh token to authenticate
   - Fetch meter readings from Octopus Energy
   - Send the readings to Tado
   - Update the refresh token (Tado uses token rotation)

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OCTOPUS_API_KEY` | Your Octopus Energy API key |
| `MPRN` | Meter Point Reference Number for your gas meter |
| `GAS_SERIAL_NUMBER` | Serial number of your gas meter |
| `TADO_USERNAME` | (Optional) Your Tado account email |
| `TADO_PASSWORD` | (Optional) Your Tado account password |
| `TADO_REFRESH_TOKEN` | (Optional) Refresh token for Tado API |

## License

MIT
