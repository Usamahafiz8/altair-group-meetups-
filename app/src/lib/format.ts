const dateTime = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const dateOnly = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const timeOnly = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

export const formatDateTime = (iso: string | Date) => dateTime.format(new Date(iso));
export const formatDate = (d: Date) => dateOnly.format(d);
export const formatTime = (d: Date) => timeOnly.format(d);

export const hasStarted = (iso: string) => Date.parse(iso) <= Date.now();

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Tomorrow at the next full hour: a sensible default start time.
export function defaultStart(): Date {
  const d = new Date(Date.now() + 86_400_000);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}
