import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { levenshtein } from "../../lib/textDistance.js";

const execFileAsync = promisify(execFile);

export interface InstalledApp {
  name: string;
  path: string;
}

// Enumerates Start Menu shortcuts (all-users + current-user) instead of
// maintaining a hardcoded name->executable table. A fixed synonym list for
// STT mis-transcriptions ("cron"/"cromi"/"crome" for "Chrome") doesn't scale
// past a handful of apps; matching against what's *actually installed* on
// this machine does, with no hardcoding of app names anywhere.
const LIST_SCRIPT = `
$sh = New-Object -ComObject WScript.Shell
$dirs = @("$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs", "$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs")
$results = @()
foreach ($dir in $dirs) {
  if (Test-Path $dir) {
    Get-ChildItem -Path $dir -Filter *.lnk -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
      try {
        $sc = $sh.CreateShortcut($_.FullName)
        if ($sc.TargetPath) {
          $results += [PSCustomObject]@{ name = $_.BaseName; path = $sc.TargetPath }
        }
      } catch {}
    }
  }
}
$results | ConvertTo-Json -Compress
`;

let cache: InstalledApp[] | undefined;

export async function listInstalledApps(): Promise<InstalledApp[]> {
  if (cache) return cache;
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", LIST_SCRIPT], {
    maxBuffer: 10 * 1024 * 1024,
  });
  const trimmed = stdout.trim();
  if (!trimmed) {
    cache = [];
    return cache;
  }
  const parsed = JSON.parse(trimmed);
  cache = Array.isArray(parsed) ? parsed : [parsed];
  return cache;
}

/**
 * Fuzzy-resolves a heard/typed target (often a single garbled word, e.g.
 * "cromi") against real installed app names (often multi-word, e.g. "Google
 * Chrome") by comparing it against each word of each app name individually -
 * comparing whole strings would make "cromi" vs "Google Chrome" look like a
 * poor match purely due to length, even though "cromi" is close to "Chrome".
 */
export async function resolveInstalledApp(target: string): Promise<InstalledApp | undefined> {
  const apps = await listInstalledApps();
  const needle = target.trim().toLowerCase();
  if (!needle) return undefined;

  let best: { app: InstalledApp; distance: number } | undefined;
  for (const app of apps) {
    const words = app.name.toLowerCase().split(/[\s\-_()]+/).filter(Boolean);
    for (const word of words) {
      const distance = levenshtein(needle, word);
      if (!best || distance < best.distance) best = { app, distance };
    }
  }

  if (!best) return undefined;
  const threshold = Math.max(2, Math.ceil(Math.max(needle.length, 3) * 0.45));
  return best.distance <= threshold ? best.app : undefined;
}
