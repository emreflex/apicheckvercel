import { ISTANBUL_TIME_ZONE } from "./domain";

const clock = new Intl.DateTimeFormat("sv-SE", {
  timeZone: ISTANBUL_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function localReading(instant: number): string {
  return clock.format(instant).replace(" ", "T");
}

export function fromIstanbulDate(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const requested = `${date}T${time}:00`;
  const asUtc = Date.parse(`${requested}Z`);
  if (!Number.isFinite(asUtc)) return null;

  const offset = Date.parse(`${localReading(asUtc)}Z`) - asUtc;
  const instant = asUtc - offset;
  if (localReading(instant) !== requested) return null;
  return new Date(instant).toISOString();
}
