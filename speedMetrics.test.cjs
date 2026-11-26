const assert = require('node:assert/strict');
const test = require('node:test');
const { debugLog } = require('./debugLog.ts');
const {
  EMPTY_METRICS, createSpeedSampler, diagnose, filterHistory,
  formatSharedResult, normalizeHistoryItem, summarizeHistory, summarizeLatency,
} = require('./speedMetrics.ts');

test('diagnostic logs identify the action only in development', () => {
  const originalDev = global.__DEV__;
  const originalLog = console.log;
  const calls = [];
  try {
    console.log = (...args) => calls.push(args);
    global.__DEV__ = true;
    debugLog('measurePing / fetch', 'iniciando tentativa', { attempt: 1 });
    debugLog('App / Animated.loop', 'iniciando animação');
    global.__DEV__ = false;
    debugLog('measurePing', 'não deve ser registrado');
    assert.deepEqual(calls, [
      ['[SpeedPulse] measurePing / fetch: iniciando tentativa', { attempt: 1 }],
      ['[SpeedPulse] App / Animated.loop: iniciando animação'],
    ]);
  } finally {
    console.log = originalLog;
    if (originalDev === undefined) delete global.__DEV__;
    else global.__DEV__ = originalDev;
  }
});

test('jitter uses consecutive absolute changes and requires five valid pings', () => {
  assert.deepEqual(summarizeLatency([20, 33, 25, 30, 22]), { pingMs: 26, jitterMs: 8.5 });
  assert.throws(() => summarizeLatency([20, 33, 25, 30]), /5 amostras/);
});

test('unstable latency takes priority over high download in the diagnosis', () => {
  const metrics = { ...EMPTY_METRICS, pingMs: 50, jitterMs: 10, downloadMbps: 25 };
  assert.match(diagnose(metrics), /4K/);
  assert.match(diagnose({ ...metrics, jitterMs: 31 }), /instável/);
  assert.equal(diagnose({ ...metrics, jitterMs: null }), null);
});

test('history keeps legacy records and allows combining city and network filters', () => {
  const base = { ...EMPTY_METRICS, id: 'legacy', dateTime: '24/11/2026', city: 'Brusque', ip: '192.0.2.1' };
  const wifi = { ...base, id: 'wifi', pingMs: 20, downloadMbps: 0, connection: { kind: 'wifi', label: 'Wi-Fi' } };
  const mobile = { ...base, id: 'mobile', city: 'Joinville', pingMs: 40, downloadMbps: 20, uploadMbps: 5, connection: { kind: 'cellular', label: '5G' } };
  assert.deepEqual(summarizeHistory([base, wifi, mobile]), { averageDownload: 10, bestPing: 20, total: 3 });
  assert.deepEqual(filterHistory([base, wifi, mobile], 'all', 'Brusque'), [base, wifi]);
  assert.deepEqual(filterHistory([base, wifi, mobile], 'cellular', 'Brusque'), []);
  assert.deepEqual(filterHistory([base, wifi, mobile], 'cellular', 'Joinville'), [mobile]);
  assert.match(formatSharedResult(base), /teste parcial[\s\S]*IP: 192\.0\.2\.1[\s\S]*Jitter: —/);
});

test('history normalization keeps legacy records safe and removes invalid values', () => {
  const normalized = normalizeHistoryItem({
    id: 'legacy',
    dateTime: '24/11/2026',
    pingMs: 'invalid',
    downloadMbps: 12.5,
  });
  assert.equal(normalized.pingMs, null);
  assert.equal(normalized.downloadMbps, 12.5);
  assert.equal(normalized.uploadMbps, null);
  assert.equal(normalized.city, 'Cidade indisponível');
  assert.equal(normalized.ip, 'IP indisponível');
  assert.equal(normalizeHistoryItem({ dateTime: '24/11/2026' }), null);
});

test('speed trace uses bytes per interval and captures a short transfer once', () => {
  const samples = [];
  const record = createSpeedSampler(sample => samples.push(sample));
  record(250_000, 500);
  record(1_000_000, 1000);
  record(1_500_000, 2000);
  record(1_500_000, 2070, true);
  assert.deepEqual(samples, [{ elapsedMs: 1000, mbps: 8 }, { elapsedMs: 2000, mbps: 4 }]);

  const short = createSpeedSampler(sample => assert.deepEqual(sample, { elapsedMs: 200, mbps: 4 }));
  short(100_000, 200, true);
});
