import axios from 'axios';
import { program } from 'commander';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const TADO_CLIENT_ID = 'tado-web-app';
const TADO_CLIENT_SECRET = 'wZaRN7rpjn3FoNyF5IFuxg9uMzYJcvOoQ8QWiIqS3hfk6gLhVlG57j5YNoZL2Rtc';
const TADO_AUTH_URL = 'https://auth.tado.com/oauth';
const TADO_API_URL = 'https://my.tado.com/api/v2';

interface TokenData {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

interface DeviceCodeData {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  interval: number;
}

interface Zone {
  id: number;
  type: string;
  name: string;
}

interface MeterReading {
  consumption: number;
  interval_start: string;
  interval_end: string;
}

interface OctopusResponse {
  results: MeterReading[];
  next: string | null;
}

class TadoAuth {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;

  async authWithRefreshToken(refreshToken: string): Promise<void> {
    console.log('Authenticating with refresh token...');
    this.refreshToken = refreshToken;
    await this.refreshAccessToken();
  }

  async deviceAuthFlow(): Promise<void> {
    console.log('Initiating Tado device code flow authentication...');

    try {
      // Step 1: Request device code
      const deviceResponse = await axios.post<DeviceCodeData>(`${TADO_AUTH_URL}/device`, {
        client_id: TADO_CLIENT_ID,
        scope: 'home.user'
      });

      const deviceData = deviceResponse.data;
      console.log(`\nPlease visit: ${deviceData.verification_uri_complete}`);
      console.log('Waiting for authorization...');

      // Step 2: Poll for token
      while (true) {
        await new Promise(resolve => setTimeout(resolve, deviceData.interval * 1000));

        try {
          const tokenResponse = await axios.post<TokenData>(`${TADO_AUTH_URL}/token`, {
            client_id: TADO_CLIENT_ID,
            client_secret: TADO_CLIENT_SECRET,
            grant_type: 'device_code',
            device_code: deviceData.device_code
          });

          this.accessToken = tokenResponse.data.access_token;
          this.refreshToken = tokenResponse.data.refresh_token;
          console.log('Successfully authenticated with Tado!');
          console.log('\nIMPORTANT: Save this refresh token for GitHub Actions:');
          console.log(`TADO_REFRESH_TOKEN=${this.refreshToken}`);
          break;
        } catch (error: any) {
          if (error.response?.status === 400) {
            const errorCode = error.response.data.error;
            if (errorCode === 'authorization_pending') {
              process.stdout.write('Waiting for authorization...\r');
              continue;
            } else if (errorCode === 'expired_token') {
              throw new Error('Authorization window expired. Please try again.');
            }
          }
          throw error;
        }
      }
    } catch (error: any) {
      throw new Error(`Failed to authenticate: ${error.message}`);
    }
  }

  private async refreshAccessToken(): Promise<void> {
    if (!this.refreshToken) {
      throw new Error('No refresh token available');
    }

    try {
      const response = await axios.post<TokenData>(`${TADO_AUTH_URL}/token`, {
        client_id: TADO_CLIENT_ID,
        client_secret: TADO_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken,
        scope: 'home.user'
      });

      this.accessToken = response.data.access_token;
      this.refreshToken = response.data.refresh_token;

      // If running in GitHub Actions, update the GITHUB_ENV with the new refresh token
      if (process.env.GITHUB_ENV) {
        const fs = require('fs');
        fs.appendFileSync(process.env.GITHUB_ENV, `TADO_REFRESH_TOKEN=${this.refreshToken}\n`);
      }
    } catch (error: any) {
      throw new Error(`Failed to refresh token: ${error.message}`);
    }
  }

  async sendReadingToTado(consumption: number): Promise<void> {
    if (!this.accessToken) {
      if (process.env.GITHUB_ACTIONS && process.env.TADO_REFRESH_TOKEN) {
        await this.authWithRefreshToken(process.env.TADO_REFRESH_TOKEN);
      } else {
        await this.deviceAuthFlow();
      }
    }

    const headers = {
      Authorization: `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json'
    };

    try {
      // Get user's home ID
      const meResponse = await axios.get(`${TADO_API_URL}/me`, { headers });
      const homeId = meResponse.data.homes[0].id;

      // Get zones
      const zonesResponse = await axios.get<Zone[]>(`${TADO_API_URL}/homes/${homeId}/zones`, { headers });
      const heatingZone = zonesResponse.data.find(zone => zone.type === 'HEATING');

      if (!heatingZone) {
        throw new Error('No heating zone found in the home');
      }

      // Send meter reading
      await axios.put(
        `${TADO_API_URL}/homes/${homeId}/zones/${heatingZone.id}/state`,
        {
          setting: {
            type: 'HEATING',
            power: 'ON',
            temperature: null
          },
          meteringInfo: {
            totalConsumption: consumption,
            unit: 'm³'
          }
        },
        { headers }
      );
    } catch (error: any) {
      if (error.response?.status === 401) {
        await this.refreshAccessToken();
        await this.sendReadingToTado(consumption);
        return;
      }
      throw new Error(`Failed to send reading: ${error.message}`);
    }
  }
}

async function getMeterReadingTotalConsumption(
  apiKey: string,
  mprn: string,
  gasSerialNumber: string
): Promise<number> {
  const periodFrom = new Date(2000, 0, 1).toISOString();
  let url = `https://api.octopus.energy/v1/gas-meter-points/${mprn}/meters/${gasSerialNumber}/consumption/?group_by=quarter&period_from=${periodFrom}`;
  let totalConsumption = 0;

  while (url) {
    try {
      const response = await axios.get<OctopusResponse>(url, {
        auth: {
          username: apiKey,
          password: ''
        }
      });

      totalConsumption += response.data.results.reduce(
        (sum, reading) => sum + reading.consumption,
        0
      );

      url = response.data.next || '';
    } catch (error: any) {
      console.error(
        `Failed to retrieve data: ${error.response?.status || error.message}`
      );
      break;
    }
  }

  console.log(`Total consumption is ${totalConsumption}`);
  return totalConsumption;
}

async function main() {
  program
    .option('--tado-refresh-token <token>', 'Tado refresh token for GitHub Actions automation')
    .requiredOption('--mprn <mprn>', 'MPRN (Meter Point Reference Number) for the gas meter')
    .requiredOption('--gas-serial-number <serial>', 'Gas meter serial number')
    .requiredOption('--octopus-api-key <key>', 'Octopus API key')
    .parse();

  const options = program.opts();

  try {
    // Get total consumption from Octopus Energy API
    const consumption = await getMeterReadingTotalConsumption(
      options.octopusApiKey,
      options.mprn,
      options.gasSerialNumber
    );

    // Initialize Tado authentication and send the reading
    const tado = new TadoAuth();
    if (options.tadoRefreshToken) {
      await tado.authWithRefreshToken(options.tadoRefreshToken);
    }
    await tado.sendReadingToTado(consumption);
  } catch (error: any) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main(); 