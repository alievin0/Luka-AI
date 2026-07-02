// Client-only continuous voice-tone analysis via WebAudio.
// Audio never leaves the device — only aggregated numbers (speaking time,
// volume, pitch stats) are collected and sent alongside camera samples.

import type { VoiceMetrics } from "@/app/api/monitor/route";

export type VoiceAnalyzerHandle = {
  /** Aggregated metrics since the last flush(); resets the window. */
  flush: () => VoiceMetrics;
  /** Live 0-1 volume for UI meters. */
  currentVolume: () => number;
  stop: () => void;
};

const SPEAKING_RMS_THRESHOLD = 0.015;

/** Autocorrelation pitch estimate; returns 0 when no voiced speech. */
function estimatePitch(buf: Float32Array, sampleRate: number): number {
  let rms = 0;
  for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / buf.length);
  if (rms < SPEAKING_RMS_THRESHOLD) return 0;

  const minHz = 70;
  const maxHz = 400;
  const minLag = Math.floor(sampleRate / maxHz);
  const maxLag = Math.floor(sampleRate / minHz);
  let bestLag = 0;
  let bestCorr = 0;
  for (let lag = minLag; lag <= maxLag && lag < buf.length; lag++) {
    let corr = 0;
    for (let i = 0; i < buf.length - lag; i++) corr += buf[i] * buf[i + lag];
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }
  return bestLag ? sampleRate / bestLag : 0;
}

export async function startVoiceAnalyzer(): Promise<VoiceAnalyzerHandle | null> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);

    const buf = new Float32Array(analyser.fftSize);
    let liveVolume = 0;

    // Window accumulators, reset on flush().
    let windowStart = Date.now();
    let speakingTicks = 0;
    let totalTicks = 0;
    let volumeSum = 0;
    let pitches: number[] = [];

    const TICK_MS = 250;
    const timer = setInterval(() => {
      analyser.getFloatTimeDomainData(buf);
      let rms = 0;
      for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
      rms = Math.sqrt(rms / buf.length);
      liveVolume = rms;
      totalTicks++;
      if (rms >= SPEAKING_RMS_THRESHOLD) {
        speakingTicks++;
        volumeSum += rms;
        const pitch = estimatePitch(buf, ctx.sampleRate);
        if (pitch > 0) pitches.push(pitch);
      }
    }, TICK_MS);

    return {
      flush: () => {
        const windowSeconds = (Date.now() - windowStart) / 1000;
        const speakingSeconds = speakingTicks * (TICK_MS / 1000);
        const avgVolume = speakingTicks ? volumeSum / speakingTicks : 0;
        const pitchAvgHz = pitches.length
          ? pitches.reduce((a, b) => a + b, 0) / pitches.length
          : 0;
        const variance = pitches.length
          ? Math.sqrt(
              pitches.reduce((s, p) => s + (p - pitchAvgHz) ** 2, 0) / pitches.length,
            )
          : 0;

        windowStart = Date.now();
        speakingTicks = 0;
        totalTicks = 0;
        volumeSum = 0;
        pitches = [];

        return {
          speakingSeconds,
          windowSeconds,
          avgVolume,
          pitchAvgHz,
          pitchVariance: variance,
        };
      },
      currentVolume: () => liveVolume,
      stop: () => {
        clearInterval(timer);
        stream.getTracks().forEach((t) => t.stop());
        void ctx.close();
      },
    };
  } catch {
    return null;
  }
}
