export function isStaff (path: string, syncGlobal: unknown): boolean {
  return syncGlobal !== undefined || path === '/staff' || path.startsWith('/staff/');
}

export async function loadPublic (
  store: {setContent: (content: never) => unknown},
  fetchImpl: typeof fetch = fetch,
  url = '/public.json',
): Promise<boolean> {
  try {
    const r = await fetchImpl(url, {cache: 'no-store'});
    if (!r.ok) return false;
    store.setContent(await r.json() as never);
    return true;
  } catch {
    return false;
  }
}
