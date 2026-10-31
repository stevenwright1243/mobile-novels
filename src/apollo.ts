/**
 * Apollo, the streaming server (see phone-display.ts), as the picker sees
 * it. Apollo installs itself as a Windows service, ApolloService, which
 * Windows starts with the PC, so it's normally already running. Main checks
 * it every few seconds; the picker shows whether it's running and can start
 * it, or open its own settings page.
 *
 * Starting a service needs admin rights, so Windows asks ("allow changes?")
 * each time, unless the service's permissions let this account start it.
 * That's set once, from an admin PowerShell, by adding this account to the
 * service's permissions with `sc.exe sdset` (see getting-started.md).
 */
import fs from 'node:fs';
import { serviceStatus, startService } from './win32';

const SERVICE = 'ApolloService';
const CONFIG = 'C:Program FilesApolloconfigsunshine.conf';
// Apollo's web page is one port above its main port (47989 by default).
const DEFAULT_PORT = 47989;

export const apolloStatus = () => serviceStatus(SERVICE);
export const startApollo = () => startService(SERVICE);

/** The address of Apollo's settings page, from the port in its config. */
export function apolloSettingsUrl() {
  let port = DEFAULT_PORT;
  try {
    const config = fs.readFileSync(CONFIG, 'utf8');
    const match = /^\s*port\s*=\s*(\d+)/m.exec(config);
    if (match) {
      port = Number(match[1]);
    }
  } catch {
    // Not readable: Apollo's default.
  }
  return `https://localhost:${port + 1}`;
}
