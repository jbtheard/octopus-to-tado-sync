import axios from 'axios';

export interface MeterReading {
  interval_start: string;
  interval_end: string;
  consumption: number;
}

interface OctopusResponse {
  results: MeterReading[];
  next: string | null;
}

const INITIAL_READING_DATE = '2024-10-12T00:00:00Z';

function getOctopusApiKey(): string {
  const apiKey = process.env.OCTOPUS_API_KEY;
  if (!apiKey) {
    throw new Error('Octopus API key not found in environment variables. Please set OCTOPUS_API_KEY.');
  }
  return apiKey;
}

export async function getConsumptionForDate(
  mprn: string,
  gasSerialNumber: string,
  targetDate: Date
): Promise<number> {
  console.log(`Fetching consumption data for ${targetDate.toISOString().split('T')[0]}...`);
  
  const readings = await getDailyReadings(mprn, gasSerialNumber, targetDate);
  
  if (readings.length === 0) {
    console.log(`No consumption data found for ${targetDate.toISOString().split('T')[0]}`);
    return 0;
  }

  // Sum up all consumption values to get the meter reading
  const consumption = readings.reduce(
    (sum, reading) => sum + reading.consumption,
    0
  );

  console.log(`Consumption for ${targetDate.toISOString().split('T')[0]}: ${consumption.toFixed(3)} m³`);
  return consumption;
}

export async function getDailyReadings(
  mprn: string,
  gasSerialNumber: string,
  targetDate: Date = new Date()
): Promise<MeterReading[]> {
  const baseUrl = `https://api.octopus.energy/v1/gas-meter-points/${mprn}/meters/${gasSerialNumber}/consumption/`;
  
  // Format target date to end of day
  const endDate = new Date(targetDate);
  endDate.setHours(23, 59, 59, 999);
  
  let url = `${baseUrl}?group_by=day&period_from=${INITIAL_READING_DATE}&period_to=${endDate.toISOString()}&order_by=period`;
  const allReadings: MeterReading[] = [];

  console.log(`Fetching daily consumption data from Octopus Energy API...`);
  console.log(`MPRN: ${mprn}`);
  console.log(`Gas Serial Number: ${gasSerialNumber}`);
  console.log(`Starting from: ${INITIAL_READING_DATE}`);
  console.log(`Ending at: ${endDate.toISOString()}`);

  while (url) {
    try {
      console.log(`Making request to: ${url}`);
      const response = await axios.get<OctopusResponse>(url, {
        auth: {
          username: getOctopusApiKey(),
          password: ''
        }
      });

      if (!response.data.results || !Array.isArray(response.data.results)) {
        throw new Error('Invalid response format: results array not found');
      }

      allReadings.push(...response.data.results);
      console.log(`Retrieved ${response.data.results.length} daily readings`);

      url = response.data.next || '';
    } catch (error: any) {
      handleOctopusError(error);
      throw new Error(`Failed to retrieve consumption data: ${error.message}`);
    }
  }

  console.log(`Total daily readings retrieved: ${allReadings.length}`);
  return allReadings;
}

function handleOctopusError(error: any): void {
  const status = error.response?.status;
  const data = error.response?.data;
  
  console.error('Failed to retrieve data from Octopus Energy API:');
  console.error(`Status: ${status}`);
  console.error(`Error message: ${error.message}`);
  if (data) {
    console.error('Response data:', data);
  }

  if (status === 404) {
    console.error('This could mean:');
    console.error('1. The MPRN is incorrect');
    console.error('2. The gas serial number is incorrect');
    console.error('3. The meter point is not accessible via the API');
  } else if (status === 401) {
    console.error('This could mean:');
    console.error('1. The API key is invalid');
    console.error('2. The API key has expired');
  }
} 