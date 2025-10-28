import { useCallback, useMemo, useRef } from "react";

export type AudioResampler = {
  process: (buffer: Float32Array) => Int16Array;
  flush: () => Int16Array;
  setSampleRate: (value: number) => void;
  reset: () => void;
};

export const useAudioResampler = (targetSampleRate: number): AudioResampler => {
  const tailRef = useRef<Float32Array>(new Float32Array());
  const sampleRateRef = useRef<number>(targetSampleRate);

  const setSampleRate = useCallback(
    (value: number) => {
      sampleRateRef.current = value > 0 ? value : targetSampleRate;
      tailRef.current = new Float32Array();
    },
    [targetSampleRate],
  );

  const process = useCallback(
    (buffer: Float32Array): Int16Array => {
      const currentRate = sampleRateRef.current;
      if (currentRate <= 0) {
        return new Int16Array();
      }

      if (currentRate === targetSampleRate) {
        const output = new Int16Array(buffer.length);
        for (let i = 0; i < buffer.length; i += 1) {
          const sample = Math.max(-1, Math.min(1, buffer[i]));
          output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        }
        return output;
      }

      const ratio = currentRate / targetSampleRate;
      const previous = tailRef.current;
      const combined = new Float32Array(previous.length + buffer.length);
      combined.set(previous);
      combined.set(buffer, previous.length);

      const length = Math.floor(combined.length / ratio);
      if (length === 0) {
        tailRef.current = combined;
        return new Int16Array();
      }

      const output = new Int16Array(length);
      for (let i = 0; i < length; i += 1) {
        const index = i * ratio;
        const baseIndex = Math.floor(index);
        const nextIndex = Math.min(baseIndex + 1, combined.length - 1);
        const weight = index - baseIndex;
        const sample =
          combined[baseIndex] * (1 - weight) + combined[nextIndex] * weight;
        const clamped = Math.max(-1, Math.min(1, sample));
        output[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      }

      const consumed = Math.floor(length * ratio);
      const remaining = combined.length - consumed;
      tailRef.current =
        remaining > 0 ? combined.slice(combined.length - remaining) : new Float32Array();
      return output;
    },
    [targetSampleRate],
  );

  const flush = useCallback((): Int16Array => {
    const tail = tailRef.current;
    tailRef.current = new Float32Array();
    if (!tail.length) {
      return new Int16Array();
    }
    const output = new Int16Array(tail.length);
    for (let i = 0; i < tail.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, tail[i]));
      output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    return output;
  }, []);

  const reset = useCallback(() => {
    sampleRateRef.current = targetSampleRate;
    tailRef.current = new Float32Array();
  }, [targetSampleRate]);

  return useMemo(
    () => ({ process, flush, setSampleRate, reset }),
    [flush, process, reset, setSampleRate],
  );
};

export default useAudioResampler;
