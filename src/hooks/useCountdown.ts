import { useEffect, useState } from 'react';

export type CountdownStatus = 'upcoming' | 'live' | 'ended' | 'idle';

export interface Countdown {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  status: CountdownStatus;
  totalMs: number;
}

const pad = (n: number) => Math.max(0, Math.floor(n));

const compute = (targetIso?: string | null, endIso?: string | null): Countdown => {
  if (!targetIso) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, status: 'idle', totalMs: 0 };
  }
  const target = new Date(targetIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : NaN;
  const now = Date.now();
  if (Number.isNaN(target)) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, status: 'idle', totalMs: 0 };
  }
  if (now >= target) {
    if (!Number.isNaN(end) && now < end) {
      return { days: 0, hours: 0, minutes: 0, seconds: 0, status: 'live', totalMs: 0 };
    }
    if (!Number.isNaN(end) && now >= end) {
      return { days: 0, hours: 0, minutes: 0, seconds: 0, status: 'ended', totalMs: 0 };
    }
    return { days: 0, hours: 0, minutes: 0, seconds: 0, status: 'live', totalMs: 0 };
  }
  const diff = target - now;
  const days = pad(diff / 86_400_000);
  const hours = pad((diff % 86_400_000) / 3_600_000);
  const minutes = pad((diff % 3_600_000) / 60_000);
  const seconds = pad((diff % 60_000) / 1000);
  return { days, hours, minutes, seconds, status: 'upcoming', totalMs: diff };
};

export const useCountdown = (targetIso?: string | null, endIso?: string | null): Countdown => {
  const [tick, setTick] = useState(() => compute(targetIso, endIso));

  useEffect(() => {
    setTick(compute(targetIso, endIso));
    const id = window.setInterval(() => setTick(compute(targetIso, endIso)), 1000);
    return () => window.clearInterval(id);
  }, [targetIso, endIso]);

  return tick;
};
