import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

export function browserExecutable() {
  const candidates = [
    process.env.BROWSER_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    chromium.executablePath(),
  ];
  const executable = candidates.find(candidate => candidate && existsSync(candidate));
  if (!executable) throw new Error('Install Chrome, set BROWSER_PATH, or run npx playwright install chromium.');
  return executable;
}
