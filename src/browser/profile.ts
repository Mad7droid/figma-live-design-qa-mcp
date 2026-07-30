import { createHash } from 'node:crypto';
import { cp, mkdir, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { log } from '../log.js';

/**
 * Only what is needed to be logged in. Everything else is either huge or sensitive.
 *
 * `Login Data` (saved passwords) and `Web Data` (autofill, card numbers) are deliberately
 * absent: the brief says never store credentials, and copying a password database would
 * violate that even though we would never read it.
 */
const COPY_PATHS = [
  'Local State',
  'Default/Cookies',
  'Default/Cookies-journal',
  'Default/Network/Cookies',
  'Default/Network/Cookies-journal',
  'Default/Preferences',
  'Default/Secure Preferences',
  'Default/Local Storage/leveldb',
  'Default/Session Storage',
];

/** Reuse a copy this fresh rather than re-copying on every capture. */
const COPY_TTL_MS = 10 * 60 * 1000;

/**
 * A Chromium-family browser the user actually has. Chrome is not a given — plenty of people
 * run Brave, Edge or Arc as their daily driver, and every one of them speaks CDP and keeps
 * a Chrome-shaped profile, so all of them work for our purposes.
 */
export interface BrowserInstall {
  name: string;
  /** Playwright channel, when it has one. Preferred over executablePath. */
  channel?: 'chrome' | 'msedge';
  executablePath?: string;
  userDataDir: string;
  /** The flag needed to expose CDP, for the instructions we print on failure. */
  launchCommand: string;
}

function candidates(): BrowserInstall[] {
  const home = homedir();

  if (process.platform === 'darwin') {
    const app = (n: string, bin = n) => `/Applications/${n}.app/Contents/MacOS/${bin}`;
    const sup = (...p: string[]) => join(home, 'Library', 'Application Support', ...p);
    return [
      {
        name: 'Google Chrome', channel: 'chrome', executablePath: app('Google Chrome'),
        userDataDir: sup('Google', 'Chrome'),
        launchCommand: '/Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222',
      },
      {
        name: 'Brave Browser', executablePath: app('Brave Browser'),
        userDataDir: sup('BraveSoftware', 'Brave-Browser'),
        launchCommand: '/Applications/Brave\\ Browser.app/Contents/MacOS/Brave\\ Browser --remote-debugging-port=9222',
      },
      {
        name: 'Microsoft Edge', channel: 'msedge', executablePath: app('Microsoft Edge'),
        userDataDir: sup('Microsoft Edge'),
        launchCommand: '/Applications/Microsoft\\ Edge.app/Contents/MacOS/Microsoft\\ Edge --remote-debugging-port=9222',
      },
      {
        name: 'Arc', executablePath: app('Arc'), userDataDir: sup('Arc', 'User Data'),
        launchCommand: '/Applications/Arc.app/Contents/MacOS/Arc --remote-debugging-port=9222',
      },
      {
        name: 'Chromium', executablePath: app('Chromium'), userDataDir: sup('Chromium'),
        launchCommand: '/Applications/Chromium.app/Contents/MacOS/Chromium --remote-debugging-port=9222',
      },
    ];
  }

  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');
    const files = process.env.PROGRAMFILES || 'C:\\Program Files';
    return [
      {
        name: 'Google Chrome', channel: 'chrome',
        executablePath: join(files, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        userDataDir: join(local, 'Google', 'Chrome', 'User Data'),
        launchCommand: `"${join(files, 'Google', 'Chrome', 'Application', 'chrome.exe')}" --remote-debugging-port=9222`,
      },
      {
        name: 'Brave Browser',
        executablePath: join(files, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
        userDataDir: join(local, 'BraveSoftware', 'Brave-Browser', 'User Data'),
        launchCommand: `"${join(files, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')}" --remote-debugging-port=9222`,
      },
      {
        name: 'Microsoft Edge', channel: 'msedge',
        executablePath: join(files, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        userDataDir: join(local, 'Microsoft', 'Edge', 'User Data'),
        launchCommand: `"${join(files, 'Microsoft', 'Edge', 'Application', 'msedge.exe')}" --remote-debugging-port=9222`,
      },
    ];
  }

  return [
    {
      name: 'Google Chrome', channel: 'chrome', executablePath: '/usr/bin/google-chrome',
      userDataDir: join(home, '.config', 'google-chrome'),
      launchCommand: 'google-chrome --remote-debugging-port=9222',
    },
    {
      name: 'Brave Browser', executablePath: '/usr/bin/brave-browser',
      userDataDir: join(home, '.config', 'BraveSoftware', 'Brave-Browser'),
      launchCommand: 'brave-browser --remote-debugging-port=9222',
    },
    {
      name: 'Chromium', executablePath: '/usr/bin/chromium',
      userDataDir: join(home, '.config', 'chromium'),
      launchCommand: 'chromium --remote-debugging-port=9222',
    },
  ];
}

const exists = async (p: string): Promise<boolean> => {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
};

/** Every Chromium-family browser present on this machine, most-preferred first. */
export async function detectBrowsers(): Promise<BrowserInstall[]> {
  const found: BrowserInstall[] = [];
  for (const c of candidates()) {
    if (c.executablePath && (await exists(c.executablePath))) found.push(c);
  }
  return found;
}

/** The first detected browser that also has a usable profile directory. */
export async function findProfileSource(): Promise<BrowserInstall | null> {
  for (const install of await detectBrowsers()) {
    // A bare app bundle with no profile has never been run and holds no session.
    if (await exists(join(install.userDataDir, 'Default'))) return install;
  }
  return null;
}

/**
 * Copy the session-bearing subset of a Chrome profile to a scratch directory.
 *
 * The copy is not optional:
 *   1. A running Chrome holds SingletonLock on the live directory. Launching against it
 *      either fails outright or hands the request to the running instance, returning a
 *      browser we cannot drive.
 *   2. Cookies and Local Storage are SQLite/LevelDB stores under exclusive locks.
 *      Concurrent access corrupts them.
 *   3. Playwright mutates whatever profile it launches. Doing that to a designer's
 *      daily-driver profile is not acceptable.
 *
 * Only a subset is copied because full profiles run 2-20 GB — Cache, Code Cache, Service
 * Worker and IndexedDB dominate. The subset is typically under 50 MB.
 */
export async function copyProfile(source: string): Promise<string> {
  const dest = join(tmpdir(), 'design-qa-profile-' + createHash('sha1').update(source).digest('hex').slice(0, 8));

  try {
    const s = await stat(dest);
    if (Date.now() - s.mtimeMs < COPY_TTL_MS) {
      log.debug('reusing recent profile copy', dest);
      return dest;
    }
  } catch {
    /* first run */
  }

  await mkdir(join(dest, 'Default', 'Network'), { recursive: true });
  for (const rel of COPY_PATHS) {
    try {
      await cp(join(source, rel), join(dest, rel), { recursive: true, force: true });
    } catch {
      // Chrome versions differ in which of these exist; missing entries are normal.
    }
  }
  log.debug('copied Chrome profile subset', dest);
  return dest;
}
