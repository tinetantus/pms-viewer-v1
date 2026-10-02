export async function api<T>(path: string, body?: unknown, method?: string): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: method || (body ? 'POST' : 'GET'),
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || data.message || 'Request failed');
  return data;
}
export const date = (value: string) =>
  new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Bangkok',
  }).format(new Date(value));
export const label = (value: string) => value.replaceAll('_', ' ');
