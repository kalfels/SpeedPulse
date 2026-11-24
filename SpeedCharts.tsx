import { type ReactNode, useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Line, Path, Polyline, Stop } from 'react-native-svg';
import type { SpeedSample } from './speedMetrics';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const RADIUS = 92;
const ARC_LENGTH = Math.PI * RADIUS;
const ARC_PATH = 'M 18 105 A 92 92 0 0 1 202 105';

export function SpeedGauge({ mbps, children }: { mbps: number; children: ReactNode }) {
  const [offset] = useState(() => new Animated.Value(ARC_LENGTH));
  const fraction = Math.log10(1 + Math.min(Math.max(mbps, 0), 1000)) / Math.log10(1001);

  useEffect(() => {
    const animation = Animated.timing(offset, {
      toValue: ARC_LENGTH * (1 - fraction),
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [fraction, offset]);

  return (
    <View style={styles.gauge}>
      <Svg width="100%" height={116} viewBox="0 0 220 116" accessible={false}>
        <Defs>
          <LinearGradient id="speedArc" x1="0%" y1="0%" x2="100%" y2="0%">
            <Stop offset="0%" stopColor="#22D3EE" />
            <Stop offset="100%" stopColor="#A855F7" />
          </LinearGradient>
        </Defs>
        <Path d={ARC_PATH} fill="none" stroke="#29364D" strokeWidth={10} strokeLinecap="round" />
        <AnimatedPath
          d={ARC_PATH}
          fill="none"
          stroke="url(#speedArc)"
          strokeWidth={10}
          strokeLinecap="round"
          strokeDasharray={[ARC_LENGTH, ARC_LENGTH]}
          strokeDashoffset={offset}
        />
      </Svg>
      <View style={styles.readout}>{children}</View>
      <View style={styles.scale}>
        <Text style={styles.axis}>0</Text>
        <Text style={styles.axis}>1.000+ Mbps</Text>
      </View>
    </View>
  );
}

export function SpeedSparkline({ samples, label, color }: {
  samples: SpeedSample[];
  label: string;
  color: string;
}) {
  const latest = samples[samples.length - 1];
  const max = Math.max(1, ...samples.map(sample => sample.mbps));
  const lastMs = Math.max(1000, latest?.elapsedMs ?? 0);
  const points = samples.map(sample => ({
    x: 4 + 128 * sample.elapsedMs / lastMs,
    y: 29 - 24 * sample.mbps / max,
  }));
  const end = points[points.length - 1];

  return (
    <View style={styles.sparkline}>
      <Text style={[styles.traceLabel, { color }]}>{label}</Text>
      <Svg width="100%" height={32} viewBox="0 0 136 32" preserveAspectRatio="none" accessible={false}>
        <Line x1={4} y1={29} x2={132} y2={29} stroke="#29364D" />
        {points.length > 1 && (
          <Polyline
            points={points.map(({ x, y }) => `${x},${y}`).join(' ')}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinejoin="round"
          />
        )}
        {end && <Circle cx={end.x} cy={end.y} r={2.5} fill={color} />}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  gauge: { width: '100%', maxWidth: 220, alignSelf: 'center' },
  readout: { position: 'absolute', top: 26, left: 18, right: 18, alignItems: 'center' },
  scale: { paddingHorizontal: 10, flexDirection: 'row', justifyContent: 'space-between' },
  axis: { color: '#94A3B8', fontSize: 10 },
  sparkline: { flex: 1, gap: 2 },
  traceLabel: { fontSize: 11, fontWeight: '700' },
});
