import type { Unit } from "./types";

export const clock = (s: number) => {
  const sign = s < 0 ? "-" : "";
  s = Math.round(Math.abs(s));
  const m = Math.floor(s / 60);
  return `${sign}${m}:${String(s % 60).padStart(2, "0")}`;
};

export const pace = (s: number | null | undefined, unit: Unit) => (s ? `${clock(s)}/${unit}` : "—");

export const parseClock = (v: string): number | null => {
  const m = v.trim().match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

export const distance = (m: number | null | undefined, unit: Unit) =>
  m ? `${(m / (unit === "mi" ? 1609.344 : 1000)).toFixed(2).replace(/\.?0+$/, "")}${unit}` : "";
