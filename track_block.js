'use strict';

/*
Install and run:
  npm init -y
  npm i playwright
  npx playwright install
  node track_block.js "5-07"
*/

const { chromium } = require('playwright');

const BETTERTRANSIT_URL = 'https://bettertransitottawa.ca/tracker/blocks';
const TRANSSEE_URL = 'https://transsee.ca/routelist?a=octranspo';

const EXIT_SUCCESS = 0;
const EXIT_EXPECTED = 2;
const EXIT_UNEXPECTED = 1;

class ExpectedFailure extends Error {
  constructor(message, step, busNumber) {
    super(message);
    this.name = 'ExpectedFailure';
    this.step = step;
    this.busNumber = busNumber || null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retry(fn, attempts = 3, delayMs = 500) {
  let lastError;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await fn(i);
    } catch (err) {
      lastError = err;
      if (i < attempts) {
        await sleep(delayMs);
      }
    }
  }
  throw lastError;
}

function extractBusNumbersFromTexts(texts) {
  const set = new Set();
  for (const text of texts) {
    const matches = String(text).match(/\b\d{3,5}\b/g) || [];
    for (const m of matches) set.add(m);
  }
  return [...set];
}

function normalizeLine(line) {
  return line.replace(/\s+/g, ' ').trim();
}

function cleanLocationLine(line) {
  return normalizeLine(String(line || ''))
    .replace(/\s+Last seen.*$/i, '')
    .replace(/\s+Vehicle timed out.*$/i, '')
    .trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseExpectedBusCountFromBlockLabel(labelText) {
  const match = String(labelText || '').match(/\((\d+)\s+buses?\)/i);
  return match ? Number(match[1]) : null;
}

function extractBusNumbersFromBlockNodeText(blockNodeText) {
  const busSection = String(blockNodeText || '').split(/Bus ID/i).pop() || '';
  const ids = busSection.match(/\b\d{3,5}\b/g) || [];
  return [...new Set(ids)];
}

function pickBestLocationLine(lines, busNumber) {
  const cleaned = lines
    .map(normalizeLine)
    .filter((line) => line.length >= 12 && line.length <= 260);

  const preciseCandidates = cleaned
    .filter((line) => {
      const lower = line.toLowerCase();
      if (lower.includes('near stops by gps')) return false;
      if (/(search|home|privacy|copyright|advert|menu)/i.test(lower)) return false;
      const hasStreetContext = lower.includes(' on ') || lower.includes(' at ');
      const hasPreciseMarker = /\b(aprchg|approach|approaching|past|near|at|arriving)\b/i.test(lower);
      return hasStreetContext && hasPreciseMarker;
    })
    .sort((a, b) => b.length - a.length);

  if (preciseCandidates.length > 0) return cleanLocationLine(preciseCandidates[0]);

  const scored = cleaned
    .map((line) => {
      const lower = line.toLowerCase();
      let score = 0;
      if (line.includes(busNumber)) score += 55;
      if (lower.includes(' on ')) score += 28;
      if (lower.includes(' going ')) score += 24;
      if (lower.startsWith('vehicle ') || lower.includes(`vehicle ${busNumber}`)) score += 18;
      if (lower.startsWith('near ') || lower.includes(' near ')) score += 12;
      if (/[↑↓↗↘↖↙]/.test(line)) score += 6;
      if (lower.includes('near stops by gps')) score -= 100;
      if (/(search|home|privacy|copyright|advert|menu)/i.test(line)) score -= 20;
      score += Math.min(line.length, 140) / 14;
      return { line, score };
    })
    .filter((x) => x.score >= 20)
    .sort((a, b) => b.score - a.score || b.line.length - a.line.length);

  if (scored.length > 0) return cleanLocationLine(scored[0].line);
  return null;
}

async function safeScreenshot(page, filePath) {
  try {
    await page.screenshot({ path: filePath, fullPage: true });
  } catch (_) {
    // Ignore screenshot failures.
  }
}

async function clickComboboxByLabel(page, labelRegex) {
  const candidates = [
    page.getByRole('combobox', { name: labelRegex }).first(),
    page.locator('[aria-haspopup="listbox"]').filter({ hasText: labelRegex }).first(),
    page.locator('div').filter({ hasText: labelRegex }).first(),
    page.getByText(labelRegex).first(),
  ];

  for (const locator of candidates) {
    try {
      if ((await locator.count()) > 0) {
        await locator.click({ timeout: 3000 });
        return true;
      }
    } catch (_) {
      // Try next strategy.
    }
  }
  return false;
}

async function selectBlockAndReadBuses(page, blockArg) {
  await page.goto(BETTERTRANSIT_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(400);

  const buses = await retry(async (attempt) => {
    if (attempt > 1) {
      await page.goto(BETTERTRANSIT_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(300);
    }

    const comboboxes = page.getByRole('combobox');
    if ((await comboboxes.count()) < 2) {
      throw new Error('Expected both block and bus comboboxes');
    }

    const blockCombobox = comboboxes.nth(0);
    await blockCombobox.click({ timeout: 3000 });
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {});
    await page.keyboard.press('Backspace').catch(() => {});
    await page.keyboard.type(blockArg, { delay: 40 });
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(900);

    let selectedBlockLabel = await blockCombobox.innerText().catch(() => '');
    if (!selectedBlockLabel.includes(blockArg)) {
      const firstMatchingOption = page
        .getByRole('option')
        .filter({ hasText: new RegExp(`^${escapeRegExp(blockArg)}\\b`, 'i') })
        .first();
      if ((await firstMatchingOption.count()) > 0) {
        await firstMatchingOption.click({ timeout: 3000 });
        await page.waitForTimeout(700);
        selectedBlockLabel = await blockCombobox.innerText().catch(() => '');
      }
    }

    if (!selectedBlockLabel.includes(blockArg)) {
      const noOptionsVisible = await page.getByText(/no options/i).first().isVisible().catch(() => false);
      if (noOptionsVisible) {
        throw new ExpectedFailure(`Block not found: ${blockArg}`, 'bettertransit');
      }
      throw new ExpectedFailure(`Could not confirm selected block: ${blockArg}`, 'bettertransit');
    }

    const expectedBusCount = parseExpectedBusCountFromBlockLabel(selectedBlockLabel);

    const busCombobox = comboboxes.nth(1);
    await busCombobox.click({ timeout: 3000 }).catch(async () => {
      const openedBusFallback = await clickComboboxByLabel(page, /select\s*bus/i);
      if (!openedBusFallback) throw new Error('Could not open bus combobox');
    });
    await page.waitForTimeout(500);

    const optionTexts = await page.getByRole('option').allInnerTexts().catch(() => []);
    const optionBusNumbers = extractBusNumbersFromTexts(optionTexts);
    await page.keyboard.press('Escape').catch(() => {});

    const blockNode = page
      .locator('.block-node')
      .filter({ hasText: new RegExp(`Block:\\s*${escapeRegExp(blockArg)}`, 'i') })
      .first();

    if ((await blockNode.count()) === 0) {
      throw new Error(`Could not find block details node for ${blockArg}`);
    }
    const blockNodeText = await blockNode.innerText({ timeout: 8000 }).catch(() => '');
    const busesFromBlock = extractBusNumbersFromBlockNodeText(blockNodeText);

    let busNumbers = busesFromBlock;
    if (optionBusNumbers.length > 0 && busesFromBlock.length > 0) {
      const allowed = new Set(optionBusNumbers);
      busNumbers = busesFromBlock.filter((b) => allowed.has(b));
    }

    if (expectedBusCount && busNumbers.length > expectedBusCount) {
      busNumbers = busNumbers.slice(0, expectedBusCount);
    }

    if (busNumbers.length === 0) {
      throw new ExpectedFailure(`No bus numbers found for block: ${blockArg}`, 'bettertransit');
    }

    return busNumbers;
  }, 3, 700);

  return buses;
}

async function findBusInput(page) {
  const candidates = [
    page.locator('form[action*="fleetfind"] input[name="q"]').first(),
    page.getByPlaceholder(/BUS_NUMBER/i).first(),
    page.locator('input[value*="BUS_NUMBER" i]').first(),
    page.locator('input[placeholder*="BUS_NUMBER" i]').first(),
    page.getByRole('textbox', { name: /BUS_NUMBER/i }).first(),
    page.locator('input[name*="bus" i]').first(),
    page.locator('input[name="q"]').first(),
    page.locator('input[type="text"]').first(),
  ];

  for (const locator of candidates) {
    try {
      if ((await locator.count()) > 0) {
        await locator.waitFor({ state: 'visible', timeout: 4000 });
        return locator;
      }
    } catch (_) {
      // Try next.
    }
  }
  return null;
}

async function extractLocationTextFromTransSee(page, busNumber) {
  const scopes = ['main', '#content', '#main', 'body'];
  const lines = [];

  for (const scope of scopes) {
    try {
      const text = await page.locator(scope).first().innerText({ timeout: 2500 });
      const split = text.split('\n').map((s) => s.trim()).filter(Boolean);
      lines.push(...split);
    } catch (_) {
      // Continue with next scope.
    }
  }

  const firstPass = pickBestLocationLine(lines, busNumber);
  if (firstPass) return firstPass;

  const bodyText = await page.locator('body').innerText().catch(() => '');
  const bodyLines = bodyText.split('\n').map((s) => s.trim()).filter(Boolean);
  const secondPass = pickBestLocationLine(bodyLines, busNumber);
  if (secondPass) return secondPass;

  const regex = new RegExp(`[^\\n]{0,150}${busNumber}[^\\n]{0,150}`, 'i');
  const m = bodyText.match(regex);
  if (m && m[0]) return normalizeLine(m[0]);

  return null;
}

async function lookupBusOnTransSee(page, busNumber) {
  await page.goto(TRANSSEE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(250);

  const input = await findBusInput(page);
  if (!input) {
    throw new ExpectedFailure(`Could not locate BUS_NUMBER input for bus ${busNumber}`, 'transsee', busNumber);
  }

  await input.click({ timeout: 4000 });
  await input.fill(String(busNumber));

  const startUrl = page.url();
  const fleetSubmit = page.locator('form[action*="fleetfind"] input[type="submit"][name="Go"]').first();

  let submitted = false;
  const searchButton = page.getByRole('button', { name: /search\s*stops|go|search/i }).first();
  try {
    if ((await fleetSubmit.count()) > 0) {
      await fleetSubmit.click({ timeout: 3000 });
      submitted = true;
    }
  } catch (_) {
    // Fallback below.
  }

  try {
    if ((await searchButton.count()) > 0) {
      await searchButton.click({ timeout: 3000 });
      submitted = true;
    }
  } catch (_) {
    // Fallback to Enter.
  }

  if (!submitted) {
    await input.press('Enter');
  }

  await Promise.race([
    page.waitForURL((url) => url.href !== startUrl, { timeout: 10000 }),
    page.waitForLoadState('networkidle', { timeout: 10000 }),
  ]).catch(() => {});

  await page.waitForTimeout(500);

  const locationText = await retry(async () => {
    const line = await extractLocationTextFromTransSee(page, String(busNumber));
    if (!line) throw new Error('location not ready');
    return line;
  }, 3, 600).catch(() => null);

  if (!locationText) {
    throw new ExpectedFailure(`No location found for bus ${busNumber}`, 'transsee', busNumber);
  }

  return {
    busNumber: String(busNumber),
    locationText,
    url: page.url(),
  };
}

async function main() {
  const blockArg = process.argv[2];

  if (!blockArg) {
    console.error('Usage: node track_block.js "5-07"');
    process.exit(EXIT_EXPECTED);
    return;
  }

  const headless = process.env.HEADLESS !== '0';
  let browser;

  try {
    browser = await chromium.launch({ headless });
    const context = await browser.newContext();
    context.setDefaultTimeout(15000);

    const betterTransitPage = await context.newPage();
    let busNumbers;

    try {
      busNumbers = await selectBlockAndReadBuses(betterTransitPage, blockArg);
    } catch (err) {
      await safeScreenshot(betterTransitPage, 'bettertransit_fail.png');
      if (err instanceof ExpectedFailure) throw err;
      throw new ExpectedFailure(`BetterTransit failure: ${err.message}`, 'bettertransit');
    }

    if (!busNumbers || busNumbers.length === 0) {
      await safeScreenshot(betterTransitPage, 'bettertransit_fail.png');
      throw new ExpectedFailure(`No bus numbers found for block: ${blockArg}`, 'bettertransit');
    }

    const transSeePage = await context.newPage();
    const buses = [];

    for (const busNumber of busNumbers) {
      try {
        const result = await lookupBusOnTransSee(transSeePage, busNumber);
        buses.push(result);
      } catch (err) {
        await safeScreenshot(transSeePage, `transsee_fail_${String(busNumber).replace(/[^0-9A-Za-z_-]/g, '_')}.png`);
        if (err instanceof ExpectedFailure) throw err;
        throw new ExpectedFailure(`TransSee failure for bus ${busNumber}: ${err.message}`, 'transsee', busNumber);
      }
    }

    if (buses.length === 0) {
      throw new ExpectedFailure(`No locations extracted for block ${blockArg}`, 'transsee');
    }

    process.stdout.write(JSON.stringify({ block: blockArg, buses }));
    process.exit(EXIT_SUCCESS);
  } catch (err) {
    if (err instanceof ExpectedFailure) {
      console.error(err.message);
      process.exit(EXIT_EXPECTED);
      return;
    }

    console.error(`Unexpected error: ${err && err.message ? err.message : String(err)}`);
    process.exit(EXIT_UNEXPECTED);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

main();
