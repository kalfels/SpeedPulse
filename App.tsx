import React, { useState, useRef, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Image,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  Platform,
  Animated,
  Easing,
  FlatList,
  ScrollView,
  Share,
  Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo, { useNetInfo, type NetInfoState } from '@react-native-community/netinfo';
import * as Location from 'expo-location';
import { SpeedGauge, SpeedSparkline } from './SpeedCharts';
import {
  EMPTY_METRICS, UNKNOWN_CONNECTION, createSpeedSampler, diagnose, filterHistory,
  formatMetric, formatSharedResult, speedMbps, summarizeHistory, summarizeLatency,
  type Connection, type InterfaceFilter, type OriginInfo, type SpeedHistoryItem,
  type SpeedSample, type TestMetrics,
} from './speedMetrics';

type TestPhase = 'idle' | 'preparing' | 'ping' | 'download' | 'upload' | 'done' | 'error';
type Transfer = 'download' | 'upload';

const STORAGE_KEY = '@speedpulse:history_v1';
const DOWNLOAD_URL = 'https://speed.cloudflare.com/__down?bytes=25000000'; // ~25 MB
const UPLOAD_URL = 'https://speed.cloudflare.com/__up';
const PING_URL = 'https://speed.cloudflare.com/__down?bytes=1';
const PING_ATTEMPTS = 8;
const INTERFACE_FILTERS: { value: InterfaceFilter; label: string }[] = [
  { value: 'all', label: 'Todas as redes' },
  { value: 'wifi', label: 'Wi-Fi' },
  { value: 'cellular', label: 'Dados móveis' },
];

function describeConnection(state: NetInfoState): Connection {
  if (state.type === 'none' || state.isConnected === false) {
    return { kind: 'unknown', label: 'Sem conexão' };
  }
  switch (state.type) {
    case 'wifi': return { kind: 'wifi', label: 'Wi-Fi' };
    case 'cellular': return {
      kind: 'cellular',
      label: state.details.cellularGeneration?.toUpperCase() ?? 'Dados móveis',
    };
    case 'ethernet': return { kind: 'other', label: 'Ethernet' };
    case 'vpn': return { kind: 'other', label: 'VPN' };
    case 'unknown': return UNKNOWN_CONNECTION;
    default: return { kind: 'other', label: 'Outra rede' };
  }
}

function FilterChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.filterChip, selected && styles.filterChipSelected]}
    >
      <Text style={[styles.filterLabel, selected && styles.filterLabelSelected]}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function App() {
  const [phase, setPhase] = useState<TestPhase>('idle');
  const [liveSpeed, setLiveSpeed] = useState<number>(0);
  const [statusLabel, setStatusLabel] = useState<string>('Pronto para testar');
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [history, setHistory] = useState<SpeedHistoryItem[]>([]);
  const [metrics, setMetrics] = useState<TestMetrics>(EMPTY_METRICS);
  const [traces, setTraces] = useState<Record<Transfer, SpeedSample[]>>({ download: [], upload: [] });
  const [testConnection, setTestConnection] = useState<Connection | null>(null);
  const [interfaceFilter, setInterfaceFilter] = useState<InterfaceFilter>('all');
  const [cityFilter, setCityFilter] = useState<string | null>(null);
  const [pulseAnim] = useState(() => new Animated.Value(1));
  const network = useNetInfo();
  const isRunningRef = useRef<boolean>(false);
  const historyRef = useRef<SpeedHistoryItem[]>([]);

  useEffect(() => {
    let active = true;
    const loadHistory = async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw && active && historyRef.current.length === 0) {
          const parsed: SpeedHistoryItem[] = JSON.parse(raw);
          historyRef.current = parsed;
          setHistory(parsed);
        }
      } catch (err) {
        console.error('Erro ao carregar histórico:', err);
      }
    };
    loadHistory();
    return () => { active = false; };
  }, []);

  const persistHistory = async (items: SpeedHistoryItem[]) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch (err) {
      console.error('Erro ao salvar histórico:', err);
    }
  };

  const addHistoryRecord = async (record: SpeedHistoryItem) => {
    const updated = [record, ...historyRef.current].slice(0, 20);
    historyRef.current = updated;
    setHistory(updated);
    await persistHistory(updated);
  };

  const clearHistory = async () => {
    historyRef.current = [];
    setHistory([]);
    setCityFilter(null);
    setInterfaceFilter('all');
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      console.error('Erro ao limpar histórico:', err);
    }
  };

  // Solicita permissão de localização no app e obtém cidade atual + coordenadas
  const fetchDeviceLocation = async (): Promise<{ city: string; coordsLabel?: string } | null> => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        return null;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const { latitude, longitude } = position.coords;
      const coordsLabel = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;

      const places = await Location.reverseGeocodeAsync({ latitude, longitude });
      const firstPlace = places[0];
      const city =
        firstPlace?.city ||
        firstPlace?.subregion ||
        firstPlace?.region ||
        'Localização atual';

      return { city, coordsLabel };
    } catch (err) {
      console.error('Erro ao obter localização do dispositivo:', err);
      return null;
    }
  };

  // Obtém IP público e usa localização do aparelho (com fallback para cidade do IP)
  const fetchOriginInfo = async (): Promise<OriginInfo> => {
    const fetchJson = async (url: string) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } finally {
        clearTimeout(timer);
      }
    };

    let ip = 'IP indisponível';
    let ipCity = 'Cidade indisponível';

    try {
      const d1 = await fetchJson('https://ipwho.is/');
      if (d1 && d1.success !== false && d1.ip) {
        ip = d1.ip;
        ipCity = d1.city || 'Cidade indisponível';
      } else {
        const d2 = await fetchJson('https://ipapi.co/json/');
        if (d2 && d2.ip) {
          ip = d2.ip;
          ipCity = d2.city || 'Cidade indisponível';
        }
      }
    } catch {
      // Mantém fallback do IP
    }

    const deviceLoc = await fetchDeviceLocation();
    if (deviceLoc) {
      return {
        ip,
        city: deviceLoc.city,
        coordsLabel: deviceLoc.coordsLabel,
      };
    }

    return {
      ip,
      city: ipCity,
    };
  };

  useEffect(() => {
    if (phase === 'idle' || phase === 'done' || phase === 'error') {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.03,
            duration: 1100,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
            isInteraction: false,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1100,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
            isInteraction: false,
          }),
        ])
      );
      loop.start();
      return () => loop.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [phase, pulseAnim]);

  const measurePing = async () => {
    const samples: number[] = [];

    for (let i = 0; i < PING_ATTEMPTS; i++) {
      setStatusLabel(`Medindo latência (${i + 1}/${PING_ATTEMPTS})...`);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const start = performance.now();

      try {
        const response = await fetch(`${PING_URL}&t=${Date.now()}_${i}`, {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await response.arrayBuffer();
        samples.push(performance.now() - start);
      } catch (error) {
        console.warn(`Amostra de latência ${i + 1} sem resposta válida:`, error);
      } finally {
        clearTimeout(timeout);
      }
    }

    return summarizeLatency(samples);
  };

  const measureTransfer = (direction: Transfer): Promise<number> => {
    return new Promise((resolve, reject) => {
      const isUpload = direction === 'upload';
      const payload = isUpload ? new Uint8Array(5 * 1024 * 1024) : null;
      const xhr = new XMLHttpRequest();
      const startTime = performance.now();
      const sample = createSpeedSampler(point => setTraces(previous => ({
        ...previous,
        [direction]: [...previous[direction], point],
      })));

      xhr.timeout = 15000;
      xhr.open(isUpload ? 'POST' : 'GET', `${isUpload ? `${UPLOAD_URL}?` : `${DOWNLOAD_URL}&`}r=${Date.now()}`);
      const onProgress = ({ loaded }: { loaded: number }) => {
        const elapsedMs = performance.now() - startTime;
        if (loaded <= 0) return;
        setLiveSpeed(speedMbps(loaded, elapsedMs));
        sample(loaded, elapsedMs);
      };
      if (isUpload) {
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        if (xhr.upload) xhr.upload.onprogress = onProgress;
      } else {
        xhr.responseType = 'arraybuffer';
        xhr.onprogress = onProgress;
      }

      xhr.onload = () => {
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error(`${direction.toUpperCase()} HTTP ${xhr.status}`));
          return;
        }
        const bytes = payload?.byteLength ?? (xhr.response instanceof ArrayBuffer ? xhr.response.byteLength : 0);
        if (bytes <= 0) {
          reject(new Error(`Nenhum dado transferido no ${direction}`));
          return;
        }
        const elapsedMs = performance.now() - startTime;
        const avgMbps = speedMbps(bytes, elapsedMs);
        sample(bytes, elapsedMs, true);
        setLiveSpeed(avgMbps);
        resolve(avgMbps);
      };

      xhr.onerror = () => reject(new Error(`Falha de rede no ${direction}`));
      xhr.ontimeout = () => reject(new Error(`Tempo limite excedido no ${direction}`));
      if (payload) xhr.send(payload);
      else xhr.send();
    });
  };

  const runFullSpeedTest = async () => {
    if (isRunningRef.current) return;
    isRunningRef.current = true;

    setPhase('preparing');
    setErrorDetail(null);
    setLiveSpeed(0);
    setMetrics(EMPTY_METRICS);
    setTraces({ download: [], upload: [] });
    setTestConnection(null);

    const now = new Date();
    const dateTimeLabel = now.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    let origin: OriginInfo = { ip: 'IP indisponível', city: 'Cidade indisponível' };
    let result = { ...EMPTY_METRICS };
    let connection = describeConnection(network);

    try {
      setStatusLabel('Solicitando localização e identificando IP...');
      origin = await fetchOriginInfo();
      try {
        connection = describeConnection(await NetInfo.fetch());
      } catch (error) {
        console.warn('Não foi possível atualizar o tipo de conexão:', error);
      }
      setTestConnection(connection);

      setPhase('ping');
      result = { ...result, ...await measurePing() };
      setMetrics(result);

      setPhase('download');
      setStatusLabel('Testando velocidade de download...');
      result = { ...result, downloadMbps: await measureTransfer('download') };
      setMetrics(result);

      setPhase('upload');
      setStatusLabel('Testando velocidade de upload...');
      setLiveSpeed(0);
      result = { ...result, uploadMbps: await measureTransfer('upload') };
      setMetrics(result);

      setPhase('done');
      setStatusLabel('Diagnóstico concluído');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro durante o teste';
      setPhase('error');
      setStatusLabel('Teste interrompido');
      setErrorDetail(msg);

    } finally {
      await addHistoryRecord({
        id: `${now.getTime()}`,
        dateTime: dateTimeLabel,
        ...origin,
        ...result,
        connection,
      });
      isRunningRef.current = false;
    }
  };

  const shareResult = async (item: SpeedHistoryItem) => {
    try {
      await Share.share({ title: 'Resultado SpeedPulse', message: formatSharedResult(item) });
    } catch (error) {
      console.warn('Erro ao compartilhar o teste:', error);
      Alert.alert('Compartilhamento indisponível', 'Não foi possível abrir o compartilhamento.');
    }
  };

  const accentColor =
    phase === 'upload'
      ? '#A855F7'
      : phase === 'error'
      ? '#EF4444'
      : '#38BDF8';

  const isTesting = phase === 'preparing' || phase === 'ping' || phase === 'download' || phase === 'upload';
  const connection = testConnection ?? describeConnection(network);
  const gaugeSpeed = phase === 'download' || phase === 'upload' ? liveSpeed : metrics.downloadMbps ?? 0;
  const diagnosis = phase === 'done' ? diagnose(metrics) : null;
  const cities = [...new Set(history.map(item => item.city))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const selectedCity = cityFilter !== null && cities.includes(cityFilter) ? cityFilter : null;
  const filteredHistory = filterHistory(history, interfaceFilter, selectedCity);
  const summary = summarizeHistory(history);

  const topSection = (
    <View style={styles.topSection}>
      <View style={styles.gaugeCard}>
        <View style={styles.phasePillRow}>
          <View style={[styles.phasePill, phase === 'ping' && styles.phasePillActive]}>
            <Text style={[styles.phasePillText, phase === 'ping' && styles.phasePillTextActive]}>
              PING
            </Text>
          </View>
          <View style={[styles.phasePill, phase === 'download' && styles.phasePillActive]}>
            <Text
              style={[styles.phasePillText, phase === 'download' && styles.phasePillTextActive]}
            >
              DOWNLOAD
            </Text>
          </View>
          <View
            style={[
              styles.phasePill,
              phase === 'upload' && styles.phasePillActivePurple,
            ]}
          >
            <Text
              style={[styles.phasePillText, phase === 'upload' && styles.phasePillTextActive]}
            >
              UPLOAD
            </Text>
          </View>
        </View>

        <SpeedGauge mbps={gaugeSpeed}>
          {phase === 'ping' ? (
            <>
              <Text style={[styles.speedNumber, { color: accentColor }]}>
                {metrics.pingMs ?? '--'}
              </Text>
              <Text style={styles.speedUnit}>ms</Text>
            </>
          ) : (
            <>
              <Text style={[styles.speedNumber, { color: accentColor }]}>
                {gaugeSpeed.toFixed(1)}
              </Text>
              <Text style={styles.speedUnit}>Mbps</Text>
            </>
          )}
        </SpeedGauge>

        <View style={styles.traces}>
          <SpeedSparkline samples={traces.download} label="Download" color="#38BDF8" />
          <SpeedSparkline samples={traces.upload} label="Upload" color="#C084FC" />
        </View>
        {errorDetail && <Text style={styles.errorText}>{errorDetail}</Text>}
      </View>

      <View style={styles.metricsRow}>
        <View style={styles.metricBox}>
          <Text style={styles.metricLabel}>PING</Text>
          <Text style={styles.metricValue}>
            {metrics.pingMs !== null ? `${metrics.pingMs}` : '--'}
          </Text>
          <Text style={styles.metricSub}>ms</Text>
        </View>

        <View style={styles.metricBox}>
          <Text style={styles.metricLabel}>JITTER</Text>
          <Text style={styles.metricValue}>{metrics.jitterMs?.toFixed(1) ?? '—'}</Text>
          <Text style={styles.metricSub}>ms</Text>
        </View>

        <View style={styles.metricBox}>
          <Text style={[styles.metricLabel, { color: '#38BDF8' }]}>DOWNLOAD</Text>
          <Text style={styles.metricValue}>
            {metrics.downloadMbps !== null ? metrics.downloadMbps.toFixed(1) : '--'}
          </Text>
          <Text style={styles.metricSub}>Mbps</Text>
        </View>

        <View style={styles.metricBox}>
          <Text style={[styles.metricLabel, { color: '#C084FC' }]}>UPLOAD</Text>
          <Text style={styles.metricValue}>
            {metrics.uploadMbps !== null ? metrics.uploadMbps.toFixed(1) : '--'}
          </Text>
          <Text style={styles.metricSub}>Mbps</Text>
        </View>
      </View>

      {diagnosis && (
        <View style={styles.diagnosisCard}>
          <Text style={styles.diagnosisLabel}>DIAGNÓSTICO ESTIMADO</Text>
          <Text style={styles.diagnosisText}>{diagnosis}</Text>
        </View>
      )}

      <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={runFullSpeedTest}
          disabled={isTesting}
          style={[
            styles.startButton,
            {
              backgroundColor: isTesting ? '#1E293B' : accentColor,
            },
          ]}
        >
          <Text style={styles.startButtonText}>
            {isTesting
              ? 'TESTANDO CONEXÃO...'
              : phase === 'done' || phase === 'error'
              ? 'TESTAR NOVAMENTE'
              : 'INICIAR TESTE'}
          </Text>
        </TouchableOpacity>
      </Animated.View>

      <View style={styles.historyHeader}>
        <Text style={styles.historyTitle}>HISTÓRICO DE TESTES</Text>
        {history.length > 0 && (
          <TouchableOpacity onPress={clearHistory}>
            <Text style={styles.clearButtonText}>Limpar</Text>
          </TouchableOpacity>
        )}
      </View>
      {history.length > 0 && (
        <>
          <View style={styles.summaryCard}>
            <View style={styles.historyStat}>
              <Text style={styles.historyStatLabel}>DOWNLOAD MÉDIO</Text>
              <Text style={styles.historyStatValue}>{formatMetric(summary.averageDownload, 'Mbps', 1)}</Text>
            </View>
            <View style={styles.historyStat}>
              <Text style={styles.historyStatLabel}>MELHOR PING</Text>
              <Text style={styles.historyStatValue}>{formatMetric(summary.bestPing, 'ms')}</Text>
            </View>
            <View style={styles.historyStat}>
              <Text style={styles.historyStatLabel}>TESTES SALVOS</Text>
              <Text style={styles.historyStatValue}>{summary.total}</Text>
            </View>
          </View>
          <View style={styles.filters}>
            <View style={styles.filterRow}>
              {INTERFACE_FILTERS.map(({ value, label }) => (
                <FilterChip key={value} label={label} selected={interfaceFilter === value} onPress={() => setInterfaceFilter(value)} />
              ))}
            </View>
            {cities.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cityChips}>
                <FilterChip label="Todas as cidades" selected={selectedCity === null} onPress={() => setCityFilter(null)} />
                {cities.map(city => (
                  <FilterChip key={city} label={city} selected={selectedCity === city} onPress={() => setCityFilter(city)} />
                ))}
              </ScrollView>
            )}
          </View>
        </>
      )}
    </View>
  );

  const renderHistoryItem = ({ item }: { item: SpeedHistoryItem }) => (
    <View style={styles.historyCard}>
      <View style={styles.historyTopRow}>
        <Text style={styles.historyDateTime}>{item.dateTime}</Text>
        <Text style={styles.historyCity}>{item.city}</Text>
      </View>

      <Text style={styles.historyIp}>
        IP de origem: {item.ip}
        {item.coordsLabel ? ` • ${item.coordsLabel}` : ''}
      </Text>

      <View style={styles.historyResultsRow}>
        <View style={styles.historyStat}>
          <Text style={styles.historyStatLabel}>PING</Text>
          <Text style={styles.historyStatValue}>{formatMetric(item.pingMs, 'ms')}</Text>
        </View>
        <View style={styles.historyStat}>
          <Text style={styles.historyStatLabel}>JITTER</Text>
          <Text style={styles.historyStatValue}>{formatMetric(item.jitterMs, 'ms', 1)}</Text>
        </View>
        <View style={styles.historyStat}>
          <Text style={[styles.historyStatLabel, { color: '#38BDF8' }]}>DOWNLOAD</Text>
          <Text style={styles.historyStatValue}>
            {item.downloadMbps !== null ? `${item.downloadMbps.toFixed(1)} Mbps` : '--'}
          </Text>
        </View>
        <View style={styles.historyStat}>
          <Text style={[styles.historyStatLabel, { color: '#C084FC' }]}>UPLOAD</Text>
          <Text style={styles.historyStatValue}>
            {item.uploadMbps !== null ? `${item.uploadMbps.toFixed(1)} Mbps` : '--'}
          </Text>
        </View>
      </View>
      <View style={styles.historyFooter}>
        <Text style={styles.connectionBadge}>
          {item.connection?.label ?? UNKNOWN_CONNECTION.label}{item.uploadMbps === null ? ' · Parcial' : ''}
        </Text>
        <TouchableOpacity accessibilityRole="button" onPress={() => shareResult(item)}>
          <Text style={styles.shareLabel}>Compartilhar</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        <Image
          source={require('./assets/logo_sp_header.png')}
          style={styles.brandLogo}
          resizeMode="contain"
          alt="SpeedPulse"
        />
        <View style={styles.headerStatus}>
          <Text style={styles.statusText}>{statusLabel}</Text>
          <Text style={styles.connectionBadge}>{connection.label}</Text>
        </View>
      </View>
      <FlatList
        data={filteredHistory}
        keyExtractor={(item) => item.id}
        renderItem={renderHistoryItem}
        ListHeaderComponent={topSection}
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            {history.length === 0
              ? 'Nenhum teste salvo ainda. Toque em Iniciar Teste para registrar.'
              : 'Nenhum teste corresponde aos filtros selecionados.'}
          </Text>
        }
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

const topPadding =
  Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) + 6 : 6;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#070B14',
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 36,
  },
  topSection: {
    gap: 18,
    marginBottom: 8,
  },
  header: {
    alignItems: 'center',
    paddingTop: topPadding,
    paddingBottom: 10,
    paddingHorizontal: 20,
  },
  brandLogo: {
    width: '100%',
    maxWidth: 230,
    height: 46,
  },
  statusText: {
    fontSize: 14,
    color: '#94A3B8',
    textAlign: 'center',
    flexShrink: 1,
  },
  headerStatus: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  connectionBadge: {
    backgroundColor: '#182844',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
    color: '#BAE6FD',
    fontSize: 11,
    fontWeight: '700',
  },
  gaugeCard: {
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    borderRadius: 24,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.16)',
    alignItems: 'center',
  },
  phasePillRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
  },
  phasePill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#1E293B',
  },
  phasePillActive: {
    backgroundColor: 'rgba(56, 189, 248, 0.2)',
    borderWidth: 1,
    borderColor: '#38BDF8',
  },
  phasePillActivePurple: {
    backgroundColor: 'rgba(168, 85, 247, 0.2)',
    borderWidth: 1,
    borderColor: '#A855F7',
  },
  phasePillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: 0.8,
  },
  phasePillTextActive: {
    color: '#F8FAFC',
  },
  speedNumber: {
    fontSize: 42,
    fontWeight: '800',
    letterSpacing: -1,
  },
  speedUnit: {
    fontSize: 15,
    fontWeight: '600',
    color: '#94A3B8',
    marginTop: -4,
  },
  traces: { flexDirection: 'row', gap: 14, marginTop: 6 },
  errorText: {
    marginTop: 12,
    color: '#F87171',
    fontSize: 13,
    textAlign: 'center',
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  metricBox: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    borderRadius: 18,
    paddingVertical: 10,
    paddingHorizontal: 3,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.14)',
    alignItems: 'center',
  },
  metricLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#94A3B8',
    textAlign: 'center',
  },
  metricValue: {
    fontSize: 20,
    fontWeight: '800',
    color: '#F8FAFC',
    marginTop: 4,
  },
  metricSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  diagnosisCard: {
    backgroundColor: '#102538',
    borderColor: '#225476',
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    gap: 4,
  },
  diagnosisLabel: { color: '#7DD3FC', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  diagnosisText: { color: '#E0F2FE', fontSize: 14, fontWeight: '700' },
  startButton: {
    paddingVertical: 17,
    borderRadius: 18,
    alignItems: 'center',
  },
  startButtonText: {
    color: '#070B14',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  historyHeader: {
    marginTop: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  historyTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 1,
  },
  clearButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F87171',
  },
  summaryCard: {
    flexDirection: 'row',
    gap: 4,
    backgroundColor: '#101B30',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 6,
  },
  filters: { gap: 6 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  cityChips: { gap: 6 },
  filterChip: {
    backgroundColor: '#131E30',
    borderColor: '#26354D',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  filterChipSelected: { backgroundColor: '#16334D', borderColor: '#38BDF8' },
  filterLabel: { color: '#CBD5E1', fontSize: 11, fontWeight: '600' },
  filterLabelSelected: { color: '#BAE6FD' },
  historyCard: {
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.14)',
    gap: 6,
  },
  historyTopRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  historyDateTime: {
    fontSize: 12,
    fontWeight: '600',
    color: '#E2E8F0',
  },
  historyCity: {
    fontSize: 12,
    fontWeight: '600',
    color: '#38BDF8',
  },
  historyIp: {
    fontSize: 12,
    color: '#94A3B8',
  },
  historyResultsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(148, 163, 184, 0.1)',
  },
  historyFooter: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    marginTop: 6,
  },
  shareLabel: { color: '#7DD3FC', fontSize: 12, fontWeight: '700', paddingVertical: 8 },
  historyStat: {
    alignItems: 'center',
    flex: 1,
  },
  historyStatLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#94A3B8',
    textAlign: 'center',
  },
  historyStatValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#F8FAFC',
    marginTop: 2,
    textAlign: 'center',
  },
  emptyText: {
    color: '#64748B',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 16,
  },
});