import { getConsumptionForDate } from '../vendors/octopus';
import { sendMeterReading } from '../vendors/tado';

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseDate(dateStr: string): Date {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date format: ${dateStr}. Please use YYYY-MM-DD format.`);
  }
  return date;
}

async function updateHistoricalReadings(startDate: Date, endDate: Date) {
  const mprn = process.env.OCTOPUS_MPRN;
  const gasSerialNumber = process.env.OCTOPUS_GAS_SERIAL_NUMBER;

  if (!mprn || !gasSerialNumber) {
    throw new Error('Please set OCTOPUS_MPRN and OCTOPUS_GAS_SERIAL_NUMBER environment variables');
  }

  const currentDate = new Date(startDate);
  let successCount = 0;
  let failureCount = 0;
  let skippedCount = 0;
  let readings: { consumption: number; date: Date }[] = [];

  while (currentDate <= endDate) {
    const dateStr = currentDate.toISOString().split('T')[0];
    console.log(`\nProcessing date: ${dateStr}`);

    try {
      console.log('Fetching consumption data for', dateStr, '...');
      const consumption = await getConsumptionForDate(mprn, gasSerialNumber, currentDate);

      if (consumption > 0) {
        console.log(`Adding reading of ${consumption.toFixed(3)} m³ for ${dateStr} to batch...`);
        readings.push({
          consumption,
          date: new Date(currentDate)
        });
      } else {
        console.log(`No consumption data available for ${dateStr}`);
        failureCount++;
      }

      // Move to next day
      currentDate.setDate(currentDate.getDate() + 1);
    } catch (error) {
      console.error(`Failed to process ${dateStr}:`, error);
      failureCount++;
      currentDate.setDate(currentDate.getDate() + 1);
    }
  }

  // Submit all readings in a single batch
  if (readings.length > 0) {
    console.log(`\nSubmitting ${readings.length} readings to Tado...`);
    try {
      await sendMeterReading(readings);
      successCount = readings.length;
    } catch (error) {
      console.error('Failed to submit readings batch:', error);
      failureCount += readings.length;
    }
  }

  console.log('\nUpdate complete!');
  console.log(`Successfully updated: ${successCount} readings`);
  console.log(`Failed to update: ${failureCount} readings`);
  console.log(`Skipped (already exist): ${skippedCount} readings`);
}

// Get command line arguments
const args = process.argv.slice(2);

if (args.length !== 2) {
  console.error('Usage: bun run update-historical <start-date> <end-date>');
  console.error('Dates should be in YYYY-MM-DD format');
  console.error('Example: bun run update-historical 2025-03-05 2025-03-31');
  process.exit(1);
}

try {
  const startDate = parseDate(args[0]);
  const endDate = parseDate(args[1]);

  if (startDate > endDate) {
    throw new Error('Start date must be before or equal to end date');
  }

  // Run the script
  updateHistoricalReadings(startDate, endDate).catch(error => {
    console.error('Script failed:', error);
    process.exit(1);
  });
} catch (error) {
  console.error('Error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
} 