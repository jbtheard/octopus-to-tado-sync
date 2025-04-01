import { getConsumptionForDate } from '../vendors/octopus';
import { sendMeterReading } from '../vendors/tado';

async function updateLatestReading() {
  const mprn = process.env.OCTOPUS_MPRN;
  const gasSerialNumber = process.env.OCTOPUS_GAS_SERIAL_NUMBER;

  if (!mprn || !gasSerialNumber) {
    throw new Error('Please set OCTOPUS_MPRN and OCTOPUS_GAS_SERIAL_NUMBER environment variables');
  }

  try {
    const today = new Date();
    console.log(`Fetching consumption data for ${today.toISOString().split('T')[0]}...`);
    
    const consumption = await getConsumptionForDate(mprn, gasSerialNumber, today);
    
    if (consumption > 0) {
      console.log(`Submitting reading of ${consumption.toFixed(3)} m³ to Tado...`);
      await sendMeterReading(consumption, today);
      console.log('Successfully updated latest meter reading');
    } else {
      console.log('No consumption data available for today');
    }
  } catch (error) {
    console.error('Failed to update latest meter reading:', error);
    process.exit(1);
  }
}

// Run the script
updateLatestReading(); 