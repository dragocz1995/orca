import { describe, it, expect } from 'vitest';
import { daemonUnit, webUnit, updateService, updateTimer, elowenSudoers, type UnitParams } from '../../../src/cli/install/systemdUnits.js';
import { SERVICES } from '../../../src/cli/systemd.js';

const p: UnitParams = {
  user: 'elowen', home: '/var/lib/elowen', nodePath: '/usr/bin/node',
  daemonEntry: '/g/lib/node_modules/elowen/dist/daemon/index.js',
  webServer: '/g/lib/node_modules/elowen/web-dist/server.js',
  npmGlobalBin: '/g/bin', daemonPort: 4400, webPort: 4500, webHost: '127.0.0.1', daemonHost: '127.0.0.1',
};

describe('install/systemdUnits.daemonUnit', () => {
  const u = daemonUnit(p);
  it('runs as the service user, not root', () => expect(u).toMatch(/^User=elowen$/m));
  it('uses the global elowen command for agents (ELOWEN_CLI=elowen)', () => expect(u).toMatch(/^Environment=ELOWEN_CLI=elowen$/m));
  it('points data + logs at the user HOME', () => {
    expect(u).toMatch(/ELOWEN_DB=\/var\/lib\/elowen\/\.config\/elowen\/elowen\.db/);
    expect(u).toMatch(/ELOWEN_LOG_DIR=\/var\/lib\/elowen\/\.config\/elowen\/logs/);
  });
  it('prepends the npm-global bin to PATH so elowen + agent CLIs resolve', () => {
    expect(u).toMatch(/^Environment=PATH=\/g\/bin:/m);
  });
  it('execs the daemon entry via node and auto-restarts', () => {
    expect(u).toContain('ExecStart=/usr/bin/node /g/lib/node_modules/elowen/dist/daemon/index.js');
    expect(u).toMatch(/^Restart=on-failure$/m);
    expect(u).toMatch(/^WantedBy=multi-user\.target$/m);
  });
  it('binds 127.0.0.1 by default (private behind a proxy / on localhost)', () => expect(u).toMatch(/^Environment=ELOWEN_HOST=127\.0\.0\.1$/m));
  it('can bind 0.0.0.0 for proxy-less IP mode so the browser reaches the terminal WS', () => {
    expect(daemonUnit({ ...p, daemonHost: '0.0.0.0' })).toMatch(/^Environment=ELOWEN_HOST=0\.0\.0\.0$/m);
  });
});

describe('install/systemdUnits.webUnit', () => {
  const u = webUnit(p);
  it('binds the web port and points at the local daemon, after it', () => {
    expect(u).toMatch(/^Environment=PORT=4500$/m);
    expect(u).toMatch(/ELOWEN_DAEMON_URL=http:\/\/127\.0\.0\.1:4400/);
    expect(u).toMatch(/After=network\.target elowen-daemon\.service/);
  });
  it('runs the standalone server as the service user', () => {
    expect(u).toContain('ExecStart=/usr/bin/node /g/lib/node_modules/elowen/web-dist/server.js');
    expect(u).toMatch(/^User=elowen$/m);
  });
  it('binds the configured web host (127.0.0.1 behind a proxy)', () => expect(u).toMatch(/^Environment=HOSTNAME=127\.0\.0\.1$/m));
  it('can bind 0.0.0.0 for the proxy-less direct-port mode', () => {
    expect(webUnit({ ...p, webHost: '0.0.0.0' })).toMatch(/^Environment=HOSTNAME=0\.0\.0\.0$/m);
  });
  it('omits ELOWEN_WS_DIRECT_PORT behind a proxy (same-origin WS)', () => expect(u).not.toContain('ELOWEN_WS_DIRECT_PORT'));
  it('advertises the daemon port to the browser in IP mode (direct WS)', () => {
    expect(webUnit({ ...p, wsDirectPort: 4400 })).toMatch(/^Environment=ELOWEN_WS_DIRECT_PORT=4400$/m);
  });
});

describe('install/systemdUnits.updateService', () => {
  const u = updateService(p);
  it('is a oneshot running `elowen update --auto` as the service user', () => {
    expect(u).toMatch(/^Type=oneshot$/m);
    expect(u).toMatch(/^User=elowen$/m);
    expect(u).toContain('ExecStart=/g/bin/elowen update --auto');
  });
  it('points at the same DB as the daemon so it reads the right opt-in + missions', () => {
    expect(u).toMatch(/ELOWEN_DB=\/var\/lib\/elowen\/\.config\/elowen\/elowen\.db/);
  });
  it('is timer-triggered, never enabled directly (no [Install])', () => {
    expect(u).not.toContain('[Install]');
  });
});

describe('install/systemdUnits.updateTimer', () => {
  const u = updateTimer();
  it('fires roughly hourly and catches up after downtime', () => {
    expect(u).toMatch(/^OnUnitActiveSec=1h$/m);
    expect(u).toMatch(/^Persistent=true$/m);
    expect(u).toMatch(/^WantedBy=timers\.target$/m);
  });
});

describe('install/systemdUnits.elowenSudoers', () => {
  const s = elowenSudoers('elowen', '/usr/bin/npm install -g elowen@latest --prefix /usr');
  it('grants the service user passwordless systemctl for its own units only', () => {
    // --no-block: a web-triggered self-update must enqueue BOTH unit restarts before the daemon's own
    // restart kills the updater process (else elowen-web never restarts). The pin includes the flag.
    expect(s).toMatch(/^elowen ALL=\(root\) NOPASSWD: \/usr\/bin\/systemctl restart --no-block elowen-daemon elowen-web/m);
    expect(s).toContain('/usr/bin/systemctl is-active elowen-daemon elowen-web');
  });
  it('does not grant a blanket systemctl (least privilege)', () => {
    expect(s).not.toMatch(/NOPASSWD:\s*\/usr\/bin\/systemctl\s*$/m);
  });
  it('pins exactly the restart command the updater issues (sudo matches args positionally)', () => {
    // The pinned restart string must equal what `systemctl('restart','--no-block',...SERVICES)` runs,
    // or sudo denies it. Asserting against SERVICES guards the order coupling between the two files.
    expect(s).toContain(`/usr/bin/systemctl restart --no-block ${SERVICES.join(' ')}`);
    expect(s).toContain(`/usr/bin/systemctl is-active ${SERVICES.join(' ')}`);
  });
  it('pins the exact self-reinstall command for the service user', () => {
    expect(s).toMatch(/^elowen ALL=\(root\) NOPASSWD: \/usr\/bin\/npm install -g elowen@latest --prefix \/usr$/m);
  });
});
