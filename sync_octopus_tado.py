import argparse
import json
import os
import time
import requests
from datetime import datetime
from requests.auth import HTTPBasicAuth

TADO_CLIENT_ID = "tado-web-app"
TADO_CLIENT_SECRET = "wZaRN7rpjn3FoNyF5IFuxg9uMzYJcvOoQ8QWiIqS3hfk6gLhVlG57j5YNoZL2Rtc"
TADO_AUTH_URL = "https://auth.tado.com/oauth"


class TadoAuth:
    def __init__(self):
        self.access_token = None
        self.refresh_token = None

    def auth_with_refresh_token(self, refresh_token):
        """Authenticates using a refresh token."""
        print("Authenticating with refresh token...")
        self.refresh_token = refresh_token
        self.refresh_access_token()

    def device_auth_flow(self):
        """Initiates the device code flow authentication."""
        print("Initiating Tado device code flow authentication...")
        
        # Step 1: Request device code
        response = requests.post(
            f"{TADO_AUTH_URL}/device",
            data={
                "client_id": TADO_CLIENT_ID,
                "scope": "home.user"
            }
        )
        
        if response.status_code != 200:
            raise Exception(f"Failed to get device code: {response.text}")
        
        device_data = response.json()
        print(f"\nPlease visit: {device_data['verification_uri_complete']}")
        print("Waiting for authorization...")
        
        # Step 2: Poll for token
        while True:
            time.sleep(device_data['interval'])
            token_response = requests.post(
                f"{TADO_AUTH_URL}/token",
                data={
                    "client_id": TADO_CLIENT_ID,
                    "client_secret": TADO_CLIENT_SECRET,
                    "grant_type": "device_code",
                    "device_code": device_data['device_code']
                }
            )
            
            if token_response.status_code == 200:
                token_data = token_response.json()
                self.access_token = token_data['access_token']
                self.refresh_token = token_data['refresh_token']
                print("Successfully authenticated with Tado!")
                print("\nIMPORTANT: Save this refresh token for GitHub Actions:")
                print(f"TADO_REFRESH_TOKEN={self.refresh_token}")
                break
            elif token_response.status_code == 400:
                error = token_response.json().get('error')
                if error == 'authorization_pending':
                    print("Waiting for authorization...", end='\r')
                    continue
                elif error == 'expired_token':
                    raise Exception("Authorization window expired. Please try again.")
                else:
                    raise Exception(f"Authentication failed: {token_response.text}")
            else:
                raise Exception(f"Unexpected error: {token_response.text}")

    def refresh_access_token(self):
        """Refreshes the access token using the refresh token."""
        if not self.refresh_token:
            raise Exception("No refresh token available")
            
        response = requests.post(
            f"{TADO_AUTH_URL}/token",
            data={
                "client_id": TADO_CLIENT_ID,
                "client_secret": TADO_CLIENT_SECRET,
                "grant_type": "refresh_token",
                "refresh_token": self.refresh_token,
                "scope": "home.user"
            }
        )
        
        if response.status_code != 200:
            raise Exception(f"Failed to refresh token: {response.text}")
            
        token_data = response.json()
        self.access_token = token_data['access_token']
        self.refresh_token = token_data['refresh_token']  # Tado uses refresh token rotation
        
        # If running in GitHub Actions, update the GITHUB_ENV with the new refresh token
        if os.getenv('GITHUB_ENV'):
            with open(os.environ['GITHUB_ENV'], 'a') as f:
                f.write(f"TADO_REFRESH_TOKEN={self.refresh_token}\n")

    def send_reading_to_tado(self, consumption):
        """Sends the total consumption reading to Tado."""
        if not self.access_token:
            # If running in GitHub Actions, use refresh token
            if os.getenv('GITHUB_ACTIONS') and os.getenv('TADO_REFRESH_TOKEN'):
                self.auth_with_refresh_token(os.getenv('TADO_REFRESH_TOKEN'))
            else:
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
        
        # Get the zones in the home to find the heating zone
        zones_response = requests.get(
            f"https://my.tado.com/api/v2/homes/{home_id}/zones",
            headers=headers
        )
        
        if zones_response.status_code != 200:
            raise Exception(f"Failed to get zones: {zones_response.text}")
            
        # Find the heating zone
        heating_zone = None
        for zone in zones_response.json():
            if zone['type'] == 'HEATING':
                heating_zone = zone
                break
                
        if not heating_zone:
            raise Exception("No heating zone found in the home")
            
        # Send the meter reading as a state update
        state_response = requests.put(
            f"https://my.tado.com/api/v2/homes/{home_id}/zones/{heating_zone['id']}/state",
            headers=headers,
            json={
                "setting": {
                    "type": "HEATING",
                    "power": "ON",
                    "temperature": None
                },
                "meteringInfo": {
                    "totalConsumption": consumption,
                    "unit": "m³"
                }
            }
        )
        
        if state_response.status_code != 200:
            print(f"Failed to send reading. Status code: {state_response.status_code}")
            print(f"Response headers: {state_response.headers}")
            print(f"Request headers: {headers}")
            raise Exception(f"Failed to send reading: {state_response.text}")
            
        return state_response.json()


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

    # Optional Tado refresh token
    parser.add_argument(
        "--tado-refresh-token",
        help="Tado refresh token for GitHub Actions automation"
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
    if args.tado_refresh_token:
        tado.auth_with_refresh_token(args.tado_refresh_token)
    tado.send_reading_to_tado(consumption)
