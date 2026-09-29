// The two decisions the page makes before it syncs, kept pure so they can be
// tested without a browser. Only /staff (or a page the checker points at a
// sync server) connects and can change the store; every other path is the
// public page, which reads the saved snapshot the Worker serves.

export function isStaff (path: string, syncGlobal: unknown): boolean {
  return syncGlobal !== undefined || path === '/staff' || path.startsWith('/staff/');
}

type ContentStore = {setContent: (content: never) => unknown};
type FetchLike = (url: string, init?: RequestInit) => Promise<{ok: boolean; json: () => Promise<unknown>}>;

export async function loadPublic (store: ContentStore, fetchImpl: FetchLike = fetch, url = '/public.json'): Promise<boolean> {
  try {
    const response = await fetchImpl(url, {cache: 'no-store'});
    if (!response.ok) return false;
    store.setContent((await response.json()) as never);
    return true;
  } catch {
    return false;
  }
}
