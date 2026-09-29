// Given code: the two decisions the page makes before it mounts anything.
// Anyone may open the public page and see what was saved; only /staff (or a
// page the checker points at a sync server) connects to change it.

export function isStaff (path: string, syncGlobal: unknown): boolean {
  return syncGlobal !== undefined || path === '/staff' || path.startsWith('/staff/');
}

// Reads the published snapshot into the store. Answers false, leaving the
// store as it was, on a non-ok response or any error.
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
