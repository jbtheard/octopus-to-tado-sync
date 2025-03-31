# Octopus to Tado Sync

This repository contains a script to automatically sync your Octopus Energy smart meter readings with Tado's Energy IQ feature. The workflow provided allows you to set this up to run on a weekly basis using GitHub Actions, so your Tado Energy IQ remains up-to-date without any manual effort.

## Prerequisites

- Node.js 18 or higher
- npm
- An Octopus Energy account with a smart meter
- A Tado account with a smart thermostat

## Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/jbtheard/octopus-to-tado-sync.git
   cd octopus-to-tado-sync
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file with your credentials:
   ```bash
   cp .env.example .env
   ```
   Then edit the `.env` file with your actual values.

## Usage

### Development

To run the script in development mode:

```bash
npm run dev -- --mprn YOUR_MPRN --gas-serial-number YOUR_GAS_SERIAL --octopus-api-key YOUR_OCTOPUS_KEY
```

### Production

1. Build the TypeScript code:
   ```bash
   npm run build
   ```

2. Run the compiled JavaScript:
   ```bash
   npm start -- --mprn YOUR_MPRN --gas-serial-number YOUR_GAS_SERIAL --octopus-api-key YOUR_OCTOPUS_KEY
   ```

### GitHub Actions

To use this script with GitHub Actions:

1. Run the script locally once to get a refresh token
2. Add the following secrets to your GitHub repository:
   - `TADO_REFRESH_TOKEN`: The refresh token obtained from running the script
   - `OCTOPUS_API_KEY`: Your Octopus Energy API key
   - `MPRN`: Your gas meter MPRN
   - `GAS_SERIAL_NUMBER`: Your gas meter serial number

The GitHub Actions workflow will automatically run the script weekly and update your Tado Energy IQ with the latest readings.

## Command Line Arguments

- `--mprn`: (Required) MPRN (Meter Point Reference Number) for the gas meter
- `--gas-serial-number`: (Required) Gas meter serial number
- `--octopus-api-key`: (Required) Octopus API key
- `--tado-refresh-token`: (Optional) Tado refresh token for GitHub Actions automation

## Development

### Building

```bash
npm run build
```

### Running in Development Mode

```bash
npm run dev
```

## License

ISC
