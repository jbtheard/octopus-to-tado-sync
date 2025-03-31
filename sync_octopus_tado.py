import argparse
import json
import time
import requests
from datetime import datetime
from requests.auth import HTTPBasicAuth

TADO_CLIENT_ID = "1bb50063-6b0c-4d11-bd99-387f4a91cc46"
TADO_AUTH_URL = "https://login.tado.com/oauth2"


class TadoAuth:
    def __init__(self):
        self.access_token = None
        self.refresh_token = None

    def device_auth_flow(self):
        """Initiates the device code flow authentication."""
        print("Initiating Tado device code flow authentication...")
        
        # Step 1: Request device code
        response = requests.post(
            f"{TADO_AUTH_URL}/device_authorize",
            params={
                "client_id": TADO_CLIENT_ID,
                "scope": "offline_access",
            }
        )
        
        if response.status_code != 200:
            raise Exception(f"Failed to get device code: {response.text}")
        
        auth_data = response.json()
        verification_uri = auth_data['verification_uri_complete']
        device_code = auth_data['device_code']
        interval = auth_data['interval']
        
        print(f"\nPlease visit this URL to authenticate: {verification_uri}")
        print("Waiting for authentication...")
        
        # Step 2: Poll for token
        while True:
            time.sleep(interval)
            
            token_response = requests.post(
                f"{TADO_AUTH_URL}/token",
                params={
                    "client_id": TADO_CLIENT_ID,
                    "device_code": device_code,
                    "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                }
            )
            
            if token_response.status_code == 200:
                token_data = token_response.json()
                self.access_token = token_data['access_token']
                self.refresh_token = token_data['refresh_token']
                print("Successfully authenticated with Tado!")
                return
            elif token_response.status_code == 400:
                error_data = token_response.json()
                if error_data.get('error') == 'authorization_pending':
                    print("Waiting for authorization...")
                    continue
                else:
                    raise Exception(f"Authentication failed: {token_response.text}")
            else:
                raise Exception(f"Unexpected response: {token_response.text}")

    def refresh_access_token(self):
        """Refreshes the access token using the refresh token."""
        if not self.refresh_token:
            raise Exception("No refresh token available")
            
        response = requests.post(
            f"{TADO_AUTH_URL}/token",
            params={
                "client_id": TADO_CLIENT_ID,
                "grant_type": "refresh_token",
                "refresh_token": self.refresh_token,
            }
        )
        
        if response.status_code != 200:
            raise Exception(f"Failed to refresh token: {response.text}")
            
        token_data = response.json()
        self.access_token = token_data['access_token']
        self.refresh_token = token_data['refresh_token']  # Tado uses refresh token rotation

    def send_reading_to_tado(self, consumption):
        """Sends the total consumption reading to Tado using its Energy IQ feature."""
        if not self.access_token:
            self.device_auth_flow()
            
        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json"
        }
        
        # First, get the user's home ID
        me_response = requests.get(
            "https://my.tado.com/api/v2/me",
            headers=headers
        )
        
        if me_response.status_code == 401:
            # Token expired, refresh and retry
            self.refresh_access_token()
            headers["Authorization"] = f"Bearer {self.access_token}"
            me_response = requests.get(
                "https://my.tado.com/api/v2/me",
                headers=headers
            )
            
        if me_response.status_code != 200:
            raise Exception(f"Failed to get user info: {me_response.text}")
            
        home_id = me_response.json()['homes'][0]['id']
        
        # Send the meter reading
        reading_response = requests.post(
            f"https://energy-insights.tado.com/api/homes/{home_id}/readings",
            headers=headers,
            json={"reading": int(consumption)}
        )
        
        if reading_response.status_code != 200:
            raise Exception(f"Failed to send reading: {reading_response.text}")
            
        return reading_response.json()


def get_meter_reading_total_consumption(api_key, mprn, gas_serial_number):
    """
    Retrieves total gas consumption from the Octopus Energy API for the given gas meter point and serial number.
    """
    period_from = datetime(2000, 1, 1, 0, 0, 0)
    url = f"https://api.octopus.energy/v1/gas-meter-points/{mprn}/meters/{gas_serial_number}/consumption/?group_by=quarter&period_from={period_from.isoformat()}Z"
    total_consumption = 0.0

    while url:
        response = requests.get(
            url, auth=HTTPBasicAuth(api_key, "")
        )

        if response.status_code == 200:
            meter_readings = response.json()
            total_consumption += sum(
                interval["consumption"] for interval in meter_readings["results"]
            )
            url = meter_readings.get("next", "")
        else:
            print(
                f"Failed to retrieve data. Status code: {response.status_code}, Message: {response.text}"
            )
            break

    print(f"Total consumption is {total_consumption}")
    return total_consumption


def parse_args():
    """
    Parses command-line arguments for Tado and Octopus API credentials and meter details.
    """
    parser = argparse.ArgumentParser(
        description="Tado and Octopus API Interaction Script"
    )

    # Octopus API arguments
    parser.add_argument(
        "--mprn",
        required=True,
        help="MPRN (Meter Point Reference Number) for the gas meter",
    )
    parser.add_argument(
        "--gas-serial-number", required=True, help="Gas meter serial number"
    )
    parser.add_argument("--octopus-api-key", required=True, help="Octopus API key")

    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()

    # Get total consumption from Octopus Energy API
    consumption = get_meter_reading_total_consumption(
        args.octopus_api_key, args.mprn, args.gas_serial_number
    )

    # Initialize Tado authentication and send the reading
    tado = TadoAuth()
    tado.send_reading_to_tado(consumption)
