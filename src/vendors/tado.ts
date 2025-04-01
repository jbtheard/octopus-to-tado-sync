import axios from 'axios';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { chromium, Page } from 'playwright';

interface MeterReading {
  consumption: number;
  date: Date;
}

const execAsync = promisify(exec);

async function authenticate(page: Page): Promise<void> {
  const tadoUsername = process.env.TADO_USERNAME;
  const tadoPassword = process.env.TADO_PASSWORD;

  if (!tadoUsername || !tadoPassword) {
    throw new Error('Tado credentials not found in environment variables. Please set TADO_USERNAME and TADO_PASSWORD.');
  }

  console.log('Authentication required, logging in...');

  // Find and fill the login form
  const emailInput = await page.waitForSelector('#email, #username, #loginId', { timeout: 5000 });
  const passwordInput = await page.waitForSelector('#password', { timeout: 5000 });

  if (!emailInput || !passwordInput) {
    throw new Error('Could not find login form elements');
  }

  await emailInput.fill(tadoUsername);
  await passwordInput.fill(tadoPassword);

  // Submit login form
  const loginButton = await page.waitForSelector('button[type="submit"], button.c-btn--primary');
  if (!loginButton) {
    throw new Error('Could not find login button');
  }

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }),
    loginButton.click()
  ]);

  // Wait for successful login
  await page.waitForLoadState('networkidle');
  console.log('Successfully logged in');

  // Handle consent screen if it appears
  try {
    console.log('Checking for consent screen...');
    const consentButton = await page.waitForSelector('button:has-text("Agree"), button:has-text("Accept"), button:has-text("Allow")', {
      timeout: 5000
    });
    if (consentButton) {
      console.log('Found consent screen, clicking agree...');
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle' }),
        consentButton.click()
      ]);
      console.log('Consent given successfully');
    }
  } catch (error) {
    console.log('No consent screen found, proceeding...');
  }
}

export async function sendMeterReading(
  consumption: number | MeterReading[],
  date?: Date
): Promise<void> {
  // Convert single reading to array format for unified processing
  const readings: MeterReading[] = Array.isArray(consumption) 
    ? consumption 
    : [{ consumption, date: date || new Date() }];

  console.log(`Launching browser to submit ${readings.length} consumption reading(s)...`);
  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    executablePath: process.env.CHROME_PATH || undefined
  });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    // First navigate to the main Tado page to establish auth
    console.log('Navigating to Tado main page...');
    await page.goto('https://app.tado.com/');
    await page.waitForLoadState('networkidle');

    // Check if we need to log in
    if (await page.url().includes('login.tado.com')) {
      await authenticate(page);
    }

    // Now that we're authenticated, navigate to the meter readings page
    console.log('Navigating to meter readings page...');
    await page.goto('https://app.tado.com/en/main/home/energy-iq/settings/consumption-input/meter-readings/');
    await page.waitForLoadState('domcontentloaded');

    // Process each reading
    for (const reading of readings) {
      try {
        console.log(`Processing reading for ${reading.date.toISOString().split('T')[0]}...`);
        
        // Look for date input if it exists
        try {
          console.log('Looking for date picker...');
          const dateButton = await page.waitForSelector('app-date-picker-v2 button[type="button"]', {
            state: 'visible',
            timeout: 5000
          });
          if (dateButton) {
            console.log('Found date picker, opening it...');
            await dateButton.click();
            
            // Wait for the date picker overlay to be visible
            await page.waitForSelector('div[role="dialog"].overlay', { timeout: 5000 });
            
            const targetDate = new Date(reading.date);
            const formattedDate = targetDate.toLocaleDateString('en-US', {
              month: 'long',
              day: 'numeric',
              year: 'numeric'
            });

            // Navigate to the correct month
            const targetMonth = targetDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
            let currentMonth = await page.$eval('div[role="heading"] button[role="switch"]', el => el.textContent?.trim() || '');
            
            while (currentMonth !== targetMonth) {
              console.log(`Current month: ${currentMonth}, navigating to: ${targetMonth}`);
              const prevButton = await page.waitForSelector('button[aria-label="Previous month"]');
              await prevButton.click();
              await new Promise(resolve => setTimeout(resolve, 500)); // Wait for month to update
              currentMonth = await page.$eval('div[role="heading"] button[role="switch"]', el => el.textContent?.trim() || '');
            }
            
            console.log(`Selecting date: ${formattedDate}`);
            
            // Look for the date button with the exact aria-label
            const dateCell = await page.waitForSelector(`button[aria-label="${formattedDate}"]:not([aria-disabled="true"])`, {
              state: 'visible',
              timeout: 5000
            });
            
            if (dateCell) {
              await dateCell.click();
              console.log(`Selected date: ${formattedDate}`);
              
              // Wait for the date picker to close and check for error message
              await page.waitForSelector('div[role="dialog"].overlay', { state: 'hidden', timeout: 5000 });
              
              // Look for the error message about existing reading
              const errorMessage = await page.waitForSelector('div:has-text("There is already a reading for the selected date, please check the date or update the existing reading instead.")', {
                state: 'visible',
                timeout: 2000
              }).catch(() => null);

              if (errorMessage) {
                console.log(`Reading already exists for ${formattedDate}, skipping...`);
                // Navigate back to meter readings page after skipping
                console.log('Navigating back to meter readings page...');
                await page.goto('https://app.tado.com/en/main/home/energy-iq/settings/consumption-input/meter-readings/');
                await page.waitForLoadState('domcontentloaded');
                continue;
              }
            } else {
              console.log('Could not find the specific date in the picker or date is disabled');
              // Close the date picker
              await page.keyboard.press('Escape');
              continue;
            }
          }
        } catch (error) {
          console.log('Date picker not found or interaction failed:', error);
          continue;
        }

        // Wait for and fill the reading value
        console.log('Looking for meter reading input...');
        const readingInput = await page.waitForSelector([
          'input#reading[type="number"]',
          'input[aria-label*="Meter Reading"]',
          'input[data-test="meter-reading-input"]',
          'input[placeholder="1234"]'
        ].join(', '), {
          state: 'visible',
          timeout: 10000
        });

        if (!readingInput) {
          throw new Error('Could not find reading input field');
        }

        // Round to nearest integer for Tado
        const roundedConsumption = Math.round(reading.consumption);
        await readingInput.fill(roundedConsumption.toString());
        console.log(`Filled consumption value: ${roundedConsumption} m³ (rounded from ${reading.consumption.toFixed(3)} m³)`);

        // Unfocus the input to trigger validation
        await page.keyboard.press('Tab');

        // Check for validation message about higher value
        const validationMessage = await page.waitForSelector('div:has-text("The reading that you are trying to submit can\'t have a higher value than the ones after it")', {
          state: 'visible',
          timeout: 2000
        }).catch(() => null);

        if (validationMessage) {
          console.log('Value too high, trying to decrease it...');
          let currentValue = roundedConsumption;
          let attempts = 0;
          const maxAttempts = 5;

          while (attempts < maxAttempts) {
            currentValue--;
            console.log(`Trying value: ${currentValue} m³`);
            await readingInput.fill(currentValue.toString());
            await page.keyboard.press('Tab');

            // Wait a bit to see if validation message appears
            await new Promise(resolve => setTimeout(resolve, 500));
            
            const stillInvalid = await page.waitForSelector('div:has-text("The reading that you are trying to submit can\'t have a higher value than the ones after it")', {
              state: 'visible',
              timeout: 1000
            }).catch(() => null);

            if (!stillInvalid) {
              console.log(`Found valid value: ${currentValue} m³`);
              break;
            }

            attempts++;
            if (attempts === maxAttempts) {
              throw new Error(`Could not find valid reading value after ${maxAttempts} attempts`);
            }
          }
        }

        // Submit the form
        console.log('Looking for submit button...');
        const submitButton = await page.waitForSelector('button[type="submit"].c-btn--primary', {
          state: 'visible',
          timeout: 10000
        });

        if (!submitButton) {
          throw new Error('Could not find submit button');
        }

        console.log('Submitting reading...');
        try {
          await submitButton.click();
        } catch (error) {
          console.log('Initial click failed, trying to force click...');
          await page.evaluate((button: Element) => {
            (button as HTMLElement).click();
          }, submitButton);
        }

        // Check for success or "already exists" message
        const successMessage = await page.waitForSelector([
          'div:has-text("Congratulations")',
          'div:has-text("Reading saved")',
          'div:has-text("There is already a reading for the selected date")'
        ].join(', '), {
          state: 'visible',
          timeout: 5000
        }).catch(() => null);

        if (successMessage) {
          const message = await successMessage.textContent();
          if (message?.includes('already a reading')) {
            console.log('Reading already exists for this date, skipping...');
            // Navigate back to meter readings page after skipping
            console.log('Navigating back to meter readings page...');
            await page.goto('https://app.tado.com/en/main/home/energy-iq/settings/consumption-input/meter-readings/');
            await page.waitForLoadState('domcontentloaded');
          } else {
            console.log('Successfully submitted meter reading');
            // Navigate back to meter readings page after successful submission
            console.log('Navigating back to meter readings page...');
            await page.goto('https://app.tado.com/en/main/home/energy-iq/settings/consumption-input/meter-readings/');
            await page.waitForLoadState('domcontentloaded');
          }
        } else {
          const errorMessage = await page.waitForSelector('[class*="error"], [class*="Error"]', {
            state: 'visible',
            timeout: 2000
          }).catch(() => null);

          if (errorMessage) {
            const text = await errorMessage.textContent();
            // Only throw if it's not an "already exists" error
            if (!text?.includes('already a reading')) {
              throw new Error(`Failed to submit meter reading: ${text}`);
            } else {
              console.log('Reading already exists for this date, skipping...');
              // Navigate back to meter readings page after skipping
              console.log('Navigating back to meter readings page...');
              await page.goto('https://app.tado.com/en/main/home/energy-iq/settings/consumption-input/meter-readings/');
              await page.waitForLoadState('domcontentloaded');
            }
          }
        }

        // Wait to ensure all requests complete
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        console.error(`Failed to process reading for ${reading.date.toISOString().split('T')[0]}:`, error);
        // Continue with next reading even if one fails
        continue;
      }
    }
  } finally {
    await browser.close();
  }
} 