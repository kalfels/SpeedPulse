export function debugLog(source: string, action: string, details?: object) {
  if (__DEV__) {
    if (details) console.log(`[SpeedPulse] ${source}: ${action}`, details);
    else console.log(`[SpeedPulse] ${source}: ${action}`);
  }
}
