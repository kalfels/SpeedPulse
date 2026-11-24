export interface TestMetrics {
  pingMs: number | null;
  jitterMs: number | null;
  downloadMbps: number | null;
  uploadMbps: number | null;
}

export type ConnectionKind = 'wifi' | 'cellular' | 'other' | 'unknown';

export interface Connection {
  kind: ConnectionKind;
  label: string;
}

export interface OriginInfo {
  ip: string;
  city: string;
  coordsLabel?: string;
}

export interface SpeedHistoryItem extends OriginInfo, Omit<TestMetrics, 'jitterMs'> {
  id: string;
  dateTime: string;
  jitterMs?: number | null;
  connection?: Connection;
}

export const UNKNOWN_CONNECTION: Connection = { kind: 'unknown', label: 'Não identificada' };

export const EMPTY_METRICS: TestMetrics = {
  pingMs: null,
  jitterMs: null,
  downloadMbps: null,
  uploadMbps: null,
};

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const roundSpeed = (value: number) => Number(value.toFixed(1));

export function summarizeLatency(samples: number[]) {
  if (samples.length < 5) throw new Error('Menos de 5 amostras de latência responderam.');
  const changes = samples.slice(1).map((current, i) => Math.abs(current - samples[i]));
  return { pingMs: Math.round(mean(samples)), jitterMs: roundSpeed(mean(changes)) };
}

export function diagnose({ pingMs, jitterMs, downloadMbps }: TestMetrics) {
  if (pingMs === null || jitterMs === null || downloadMbps === null) return null;
  if (pingMs > 120 || jitterMs > 30) return 'Latência alta ou instável para chamadas e jogos online';
  if (downloadMbps >= 25 && pingMs <= 50 && jitterMs <= 10) {
    return 'Excelente para streaming 4K e jogos online';
  }
  if (downloadMbps >= 10) return 'Adequada para streaming em HD e navegação';
  if (downloadMbps >= 5) return 'Adequada para navegação; streaming pode oscilar';
  return 'Download limitado para streaming e chamadas';
}

export function summarizeHistory(items: SpeedHistoryItem[]) {
  const downloads = items.flatMap(({ downloadMbps }) => downloadMbps == null ? [] : [downloadMbps]);
  const pings = items.flatMap(({ pingMs }) => pingMs == null ? [] : [pingMs]);
  return {
    averageDownload: downloads.length ? mean(downloads) : null,
    bestPing: pings.length ? Math.min(...pings) : null,
    total: items.length,
  };
}

export type InterfaceFilter = 'all' | 'wifi' | 'cellular';

export function filterHistory(items: SpeedHistoryItem[], connection: InterfaceFilter, city: string | null) {
  return items.filter(item =>
    (connection === 'all' || item.connection?.kind === connection) &&
    (city === null || item.city === city)
  );
}

export function formatMetric(value: number | null | undefined, unit: string, digits = 0) {
  return value == null ? '—' : `${value.toFixed(digits)} ${unit}`;
}

export function formatSharedResult(item: SpeedHistoryItem) {
  return [
    `SpeedPulse — ${item.uploadMbps === null ? 'teste parcial' : 'resultado do teste'}`,
    `Data: ${item.dateTime}`,
    `Cidade: ${item.city}`,
    `IP: ${item.ip}`,
    `Conexão: ${item.connection?.label ?? UNKNOWN_CONNECTION.label}`,
    `Ping: ${formatMetric(item.pingMs, 'ms')}`,
    `Jitter: ${formatMetric(item.jitterMs, 'ms', 1)}`,
    `Download: ${formatMetric(item.downloadMbps, 'Mbps', 1)}`,
    `Upload: ${formatMetric(item.uploadMbps, 'Mbps', 1)}`,
  ].join('\n');
}

export function speedMbps(bytes: number, elapsedMs: number) {
  return roundSpeed((bytes * 8) / Math.max(elapsedMs, 50) / 1000);
}

export interface SpeedSample {
  elapsedMs: number;
  mbps: number;
}

export function createSpeedSampler(onSample: (sample: SpeedSample) => void) {
  let prevMs = 0;
  let prevBytes = 0;
  return (bytes: number, elapsedMs: number, finished = false) => {
    const interval = elapsedMs - prevMs;
    if (interval <= 0 || bytes < prevBytes || (!finished && interval < 1000)) return;
    if (finished && prevMs !== 0 && bytes === prevBytes) return;
    onSample({ elapsedMs, mbps: speedMbps(bytes - prevBytes, interval) });
    prevMs = elapsedMs;
    prevBytes = bytes;
  };
}
