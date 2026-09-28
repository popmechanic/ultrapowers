/**
 * The browser move's engine: the machine's own Chromium, driven over the
 * DevTools protocol with nothing between us and it.
 *
 * There is no client library here and no dependency to add — a CDP connection
 * is a WebSocket carrying `{id, method, params, sessionId?}` and replies
 * `{id, result|error}`, and Bun ships both the spawn and the socket. The
 * headless shell is asked for `--remote-debugging-port=0` and answers with the
 * port it chose on the `DevTools listening on ws://…` line of its stderr: Bun
 * cannot hand a child extra pipes, so the port form is the one available, and a
 * port of `0` keeps two exams running side by side from colliding.
 *
 * Nothing the page asks for leaves the machine, in either of the two forms a
 * page arrives in. `open` hands the browser a `data:` URL and installs
 * `Network.setBlockedURLs` with `["*"]` on the session before the first
 * navigation, so the only socket in the exam is the loopback one to the process
 * we spawned. `openUrl` serves the page from a loopback origin instead — a
 * persistence exam needs storage, which a `data:` page has none of — and a
 * blanket block would refuse the page's own document, so every request is paused
 * through the `Fetch` domain and judged one at a time: continued when it is to
 * that origin, failed in the browser otherwise. `client/index.html` links Google
 * Fonts; with those requests refused the page falls back to the platform
 * sans-serif, and that fallback — identical on every machine, dialling nothing —
 * is the deterministic choice, not a loss.
 */

import {existsSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// Borrowed from popmechanic/tinyapp-fixture packages/tinyapp-exam/src/browser.ts
// at d71c037 (2026-09-27); the two sibling imports are inlined below.
export type Locator = string | {role: string; name: string};
export type Action =
  | {click: Locator}
  | {type: [Locator, string]}
  | {key: [Locator, string]};

const REFLECT_CHECKED =
  '(function(){var f=function(){document.querySelectorAll("input")' +
  '.forEach(function(i){var v=i.checked?"true":"false";' +
  'if(i.getAttribute("data-checked")!==v){i.setAttribute("data-checked",v)}})};' +
  'f();new MutationObserver(f).observe(document.documentElement,' +
  '{subtree:true,childList:true,attributes:true})})()';

/** Where the fleet image keeps its headless shell. */
const DEFAULT_BINARY = '/headless-shell/headless-shell';

const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** The browser to run: an explicit path, else TINYAPP_BROWSER, else the fleet
 *  image's headless shell, else a laptop's Chrome. Nothing is installed. */
export const resolveBinary = (
  explicit?: string,
  env: Record<string, string | undefined> = process.env,
): string => {
  if (explicit) return explicit;
  if (env.TINYAPP_BROWSER) return env.TINYAPP_BROWSER;
  return existsSync(DEFAULT_BINARY) ? DEFAULT_BINARY : MAC_CHROME;
};

/** The line the shell prints once its debugging endpoint is listening. */
const DEVTOOLS_LINE = /DevTools listening on (ws:\S+)/;

/** How long that line may take. Measured at ~100 ms; this is the give-up point. */
const DEVTOOLS_TIMEOUT_MS = 15_000;

/** How long one protocol call may go unanswered before it is called a failure. */
const CALL_TIMEOUT_MS = 30_000;

/** How long `close()` waits for a polite `Browser.close` before it kills. */
const EXIT_GRACE_MS = 2_000;

/** How long `reload()` waits for the new document's load event before it goes on. */
const RELOAD_LOAD_GRACE_MS = 10_000;

/**
 * The longest `data:` URL Chromium will navigate to, in characters.
 *
 * Over it the navigation is refused silently: no error, no load event, and a
 * caller waiting on the load waits for a page that will never come. So the
 * length is measured before the navigation and the call rejects instead — which
 * is why the exam bundles minified, the difference between ~1.06 M characters
 * and ~2.59 M for this fixture.
 */
const DATA_URL_CEILING = 2_097_152;

/** One open page: act on it, read from it, photograph it, close it. */
export interface Page {
  /** Performs one action, rejecting when its locator matches nothing. */
  act(action: Action): Promise<void>;
  /** The JSON value of `expression` evaluated in the page. */
  evaluate(expression: string): Promise<unknown>;
  /** How many elements match this accessible role and name. */
  count(locator: {role: string; name: string}): Promise<number>;
  /** The document's outer HTML with `data-checked` reflected, and a PNG. */
  snapshot(): Promise<{dom: string; screenshot: Uint8Array}>;
  /** Detaches from the target and closes it. */
  close(): Promise<void>;
  /**
   * Reloads this same tab and resolves once the new document has loaded.
   *
   * Optional, so a stand-in `Page` is one without it. It resolves on the load
   * event rather than on the protocol call, because a caller polling the page
   * for a handle the app sets would otherwise read the outgoing document's
   * globals and call the reload finished before it began.
   */
  reload?(): Promise<void>;
}

/** One running browser process. */
export interface Browser {
  /** The arguments it was spawned with, `argv[0]` the binary. */
  readonly argv: string[];
  /**
   * Opens `html` as a page whose clock is pinned to `clock`, rejecting when the
   * `data:` URL it would need is over the browser's ceiling.
   */
  open(opts: {html: string; clock: string}): Promise<Page>;
  /**
   * Opens `url` in a page whose clock is pinned to `clock`, which runs `prelude`
   * on every new document of it, and every request of which is refused in the
   * browser unless it is to `origin` or to an origin `allow` lists.
   *
   * `allow` is how a page reaches a *second* loopback origin — the runtime a
   * convergence exam syncs through — without the block being lifted: each entry
   * is judged by the same rule `origin` is, so an origin not named is refused
   * exactly as the whole world outside is.
   *
   * Optional, so a stand-in `Browser` is one without it. It resolves as soon as
   * the navigation is under way rather than on a load event: the page it is
   * meant for redirects on its first document, and the caller is polling the
   * page for its own signal of readiness anyway.
   */
  openUrl?(opts: {
    url: string;
    origin: string;
    clock: string;
    prelude?: string;
    allow?: string[];
  }): Promise<Page>;
  /** Ends the process and removes its user data directory. */
  close(): Promise<void>;
}

/** A reply or an event off the wire. */
type Incoming = {
  id?: number;
  result?: Record<string, unknown>;
  error?: {message?: string; code?: number};
  method?: string;
  params?: Record<string, unknown>;
  sessionId?: string;
};

/** The pieces of a connection the rest of this module speaks through. */
type Connection = {
  send(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
  ): Promise<Record<string, unknown>>;
  /** Resolves with the first `method` event on `sessionId`, armed when called. */
  once(method: string, sessionId: string): Promise<Record<string, unknown>>;
  /**
   * Calls `handler` for every `method` event on `sessionId`, until the
   * connection closes.
   *
   * `once` cannot stand in for it: a request interceptor has to answer every
   * paused request, not the first one, and a one-shot listener re-armed from
   * inside its own handler drops whatever arrived in between.
   */
  on(
    method: string,
    sessionId: string,
    handler: (params: Record<string, unknown>) => void,
  ): void;
  close(): void;
};

/** The base64 payload as bytes. */
const fromBase64 = (base64: string): Uint8Array =>
  Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));

/** A promise that settles after `ms`, its timer unref'd so it holds nothing open. */
const after = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    (timer as unknown as {unref?: () => void}).unref?.();
  });

/**
 * The script installed on every new document of the page.
 *
 * It replaces `Date` before a line of the app runs, so `Date.now()` and a bare
 * `new Date()` are the exam's instant; `new Date(x)`, `Date.parse` and
 * `Date.UTC` keep working, inherited from the real constructor.
 */
const clockPin = (clock: string): string => {
  const instant = Date.parse(clock);
  if (Number.isNaN(instant)) {
    throw new Error(`browser: clock is not a date: ${clock}`);
  }
  return (
    `const t = ${instant}; const D = Date; globalThis.Date = class extends D ` +
    `{ constructor(...a) { super(...(a.length ? a : [t])); } static now() { return t; } }`
  );
};

/**
 * What `open` waits for after the load event: three turns of two animation
 * frames and a macrotask, capped at a second in case a machine paints no frames.
 *
 * The load event is not the moment a page is worth looking at. The app paints
 * after it — React mounts on a microtask — and a blocked request dispatches its
 * `error` a few milliseconds later still, so an exam that reads `__WS_FAILED`
 * the instant `open` resolves would be reading a page mid-sentence. Waiting is
 * the deterministic move: every turn here is the page's own clock advancing, and
 * the cap means a page that never paints costs a second rather than the call.
 */
const SETTLE =
  'new Promise(function (done) {' +
  'var left = 3; var stop = setTimeout(done, 1000);' +
  'var turn = function () {' +
  'if (left-- === 0) { clearTimeout(stop); done(); return; }' +
  'requestAnimationFrame(function () { requestAnimationFrame(function () { setTimeout(turn, 0) }) })' +
  '}; turn()' +
  '})';

/** Opens a CDP connection to `url` and resolves once it is talking. */
const connect = async (url: string): Promise<Connection> => {
  const socket = new WebSocket(url);
  const pending = new Map<
    number,
    {resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void}
  >();
  const waiters = new Map<string, ((params: Record<string, unknown>) => void)[]>();
  const listeners = new Map<string, ((params: Record<string, unknown>) => void)[]>();
  let closed: Error | null = null;
  let nextId = 1;

  socket.addEventListener('message', (event: MessageEvent) => {
    const message = JSON.parse(String(event.data)) as Incoming;
    if (typeof message.id === 'number') {
      const call = pending.get(message.id);
      pending.delete(message.id);
      if (call === undefined) {
        return;
      }
      if (message.error !== undefined) {
        call.reject(new Error(`browser: ${message.error.message ?? 'protocol error'}`));
      } else {
        call.resolve(message.result ?? {});
      }
      return;
    }
    if (typeof message.method !== 'string') {
      return;
    }
    const key = `${message.sessionId ?? ''} ${message.method}`;
    for (const waiter of waiters.get(key) ?? []) {
      waiter(message.params ?? {});
    }
    waiters.delete(key);
    for (const listener of listeners.get(key) ?? []) {
      listener(message.params ?? {});
    }
  });

  const give = (reason: string) => {
    closed = new Error(`browser: ${reason}`);
    for (const call of pending.values()) {
      call.reject(closed);
    }
    pending.clear();
  };
  socket.addEventListener('close', () => give('connection closed'));
  socket.addEventListener('error', () => give('connection failed'));

  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve());
    socket.addEventListener('error', () =>
      reject(new Error(`browser: cannot connect to ${url}`)),
    );
  });

  return {
    send: (method, params = {}, sessionId) => {
      if (closed !== null) {
        return Promise.reject(closed);
      }
      const id = nextId++;
      const message: Record<string, unknown> = {id, method, params};
      if (sessionId !== undefined) {
        message.sessionId = sessionId;
      }
      return new Promise<Record<string, unknown>>((resolve, reject) => {
        pending.set(id, {resolve, reject});
        socket.send(JSON.stringify(message));
        void after(CALL_TIMEOUT_MS).then(() => {
          if (pending.delete(id)) {
            reject(new Error(`browser: ${method} did not answer`));
          }
        });
      });
    },
    once: (method, sessionId) =>
      new Promise((resolve) => {
        const key = `${sessionId} ${method}`;
        waiters.set(key, [...(waiters.get(key) ?? []), resolve]);
      }),
    on: (method, sessionId, handler) => {
      const key = `${sessionId} ${method}`;
      listeners.set(key, [...(listeners.get(key) ?? []), handler]);
    },
    close: () => socket.close(),
  };
};

/**
 * Reads the shell's stderr until the DevTools line, and keeps draining it after.
 *
 * The child blocks on a full stderr pipe, so the tail is read and dropped for
 * as long as the process lives.
 */
const devtoolsUrl = async (stream: ReadableStream<Uint8Array>): Promise<string> => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let seen = '';

  const drain = (async (): Promise<string> => {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) {
        throw new Error('browser: no devtools line');
      }
      seen += decoder.decode(value, {stream: true});
      const found = DEVTOOLS_LINE.exec(seen);
      if (found !== null) {
        // Nothing awaits this: it only keeps the pipe from filling.
        void (async () => {
          try {
            for (;;) {
              const next = await reader.read();
              if (next.done) {
                return;
              }
            }
          } catch {
            return;
          }
        })();
        return found[1]!;
      }
    }
  })();

  return await Promise.race([
    drain,
    after(DEVTOOLS_TIMEOUT_MS).then((): never => {
      throw new Error('browser: no devtools line');
    }),
  ]);
};

/**
 * How the DOM domain is told which element is meant.
 *
 * `DOM.getBoxModel`, `DOM.focus` and `DOM.resolveNode` each take a `nodeId` or
 * a `backendNodeId` in the same slot, so the two resolvers below — the selector
 * one and the accessibility one — hand back a parameter object and every call
 * after them spreads it, rather than each one knowing which kind of id it got.
 */
type NodeRef = {nodeId: number} | {backendNodeId: number};

/** How a locator reads in `act`'s rejection. */
const spellLocator = (locator: Locator): string =>
  typeof locator === 'string'
    ? locator
    : `role=${locator.role} name=${JSON.stringify(locator.name)}`;

/** The document's root nodeId — the scope every query below starts from. */
const rootOf = async (connection: Connection, sessionId: string): Promise<number> => {
  const document = (await connection.send('DOM.getDocument', {}, sessionId)) as {
    root?: {nodeId?: number};
  };
  return document.root?.nodeId ?? 0;
};

/**
 * The first element `locator` names, or a rejection spelling it.
 *
 * A string goes to `DOM.querySelector`. A `{role, name}` goes to
 * `Accessibility.queryAXTree`, which answers the nodes whose computed role and
 * computed *accessible name* are both what was asked for, in tree order — so
 * "the first match" means the same thing for both forms. The accessible name is
 * the browser's own computation and nothing a selector can reach: a `<label
 * for>` names its input, an `aria-label` names anything at all, and a bare
 * `placeholder` names a text input.
 *
 * `Accessibility.enable` is idempotent and cheap, and the domain is off until
 * something asks for it, so it is enabled here rather than at `open`: a page
 * that only ever acts on selectors never turns the tree on.
 */
const nodeFor = async (
  connection: Connection,
  sessionId: string,
  locator: Locator,
): Promise<NodeRef> => {
  if (typeof locator === 'string') {
    const found = (await connection.send(
      'DOM.querySelector',
      {nodeId: await rootOf(connection, sessionId), selector: locator},
      sessionId,
    )) as {nodeId?: number};
    if (found.nodeId === undefined || found.nodeId === 0) {
      throw new Error(`act: no element matches ${spellLocator(locator)}`);
    }
    return {nodeId: found.nodeId};
  }

  await connection.send('Accessibility.enable', {}, sessionId);
  const found = (await connection.send(
    'Accessibility.queryAXTree',
    {
      nodeId: await rootOf(connection, sessionId),
      role: locator.role,
      accessibleName: locator.name,
    },
    sessionId,
  )) as {nodes?: {backendDOMNodeId?: number}[]};
  const backendNodeId = (found.nodes ?? []).find(
    (node) => node.backendDOMNodeId !== undefined && node.backendDOMNodeId !== 0,
  )?.backendDOMNodeId;
  if (backendNodeId === undefined) {
    throw new Error(`act: no element matches ${spellLocator(locator)}`);
  }
  return {backendNodeId};
};

/**
 * The centre of a node's content box, or `null` when it has no area.
 *
 * `content` is the quad x1 y1 x2 y2 x3 y3 x4 y4. An unstyled `<span
 * role="checkbox">` has a content box of zero width and height, and a mouse
 * event dispatched at the centre of that box lands on whatever is painted
 * underneath — `<body>`, not the span. So a degenerate box is reported as one
 * rather than clicked at, and `act` takes the other path for it.
 */
const centreOf = async (
  connection: Connection,
  sessionId: string,
  node: NodeRef,
): Promise<{x: number; y: number} | null> => {
  const box = (await connection
    .send('DOM.getBoxModel', {...node}, sessionId)
    .catch(() => ({}))) as {model?: {content?: number[]}};
  const content = box.model?.content ?? [];
  if (content.length < 8) {
    return null;
  }
  const xs = [content[0]!, content[2]!, content[4]!, content[6]!];
  const ys = [content[1]!, content[3]!, content[5]!, content[7]!];
  if (Math.max(...xs) - Math.min(...xs) === 0 || Math.max(...ys) - Math.min(...ys) === 0) {
    return null;
  }
  return {x: (content[0]! + content[4]!) / 2, y: (content[1]! + content[5]!) / 2};
};

/**
 * Calls `click()` on the element itself, in the page.
 *
 * The fallback for an element with no box to aim at: `DOM.resolveNode` turns
 * the id into a `Runtime` handle and `Runtime.callFunctionOn` invokes the
 * element's own method, which dispatches a trusted-enough `click` event through
 * the same listeners a mouse would have reached.
 */
const clickInPage = async (
  connection: Connection,
  sessionId: string,
  node: NodeRef,
): Promise<void> => {
  const resolved = (await connection.send('DOM.resolveNode', {...node}, sessionId)) as {
    object?: {objectId?: string};
  };
  const objectId = resolved.object?.objectId;
  if (objectId === undefined) {
    throw new Error('act: element cannot be reached in the page');
  }
  await connection.send(
    'Runtime.callFunctionOn',
    {objectId, functionDeclaration: 'function () { this.click() }'},
    sessionId,
  );
};

/** Builds the `Page` facade over one attached target. */
const pageOn = (
  connection: Connection,
  sessionId: string,
  targetId: string,
): Page => {
  let open = true;
  const live = (): void => {
    if (!open) {
      throw new Error('page: closed');
    }
  };

  const evaluate = async (expression: string): Promise<unknown> => {
    live();
    const answer = (await connection.send(
      'Runtime.evaluate',
      {expression, returnByValue: true, awaitPromise: true},
      sessionId,
    )) as {
      result?: {value?: unknown};
      exceptionDetails?: {exception?: {description?: string}; text?: string};
    };
    if (answer.exceptionDetails !== undefined) {
      const detail = answer.exceptionDetails;
      throw new Error(
        `evaluate: ${detail.exception?.description ?? detail.text ?? 'threw'}`,
      );
    }
    return answer.result?.value;
  };

  return {
    evaluate,

    count: async (locator) => {
      await connection.send('Accessibility.enable', {}, sessionId);
      const found = (await connection.send('Accessibility.queryAXTree', {
        nodeId: await rootOf(connection, sessionId),
        role: locator.role,
        accessibleName: locator.name,
      }, sessionId)) as {nodes?: {backendDOMNodeId?: number; ignored?: boolean}[]};
      return (found.nodes ?? []).filter(
        (n) => !n.ignored && (n.backendDOMNodeId ?? 0) !== 0).length;
    },

    act: async (action: Action): Promise<void> => {
      live();
      if ('click' in action) {
        const node = await nodeFor(connection, sessionId, action.click);
        // A box below the fold is off the viewport, and a mouse event aimed at
        // it lands on nothing — so the element is scrolled into view first.
        await connection
          .send('DOM.scrollIntoViewIfNeeded', {...node}, sessionId)
          .catch(() => undefined);
        const centre = await centreOf(connection, sessionId, node);
        if (centre === null) {
          await clickInPage(connection, sessionId, node);
          return;
        }
        const {x, y} = centre;
        for (const type of ['mousePressed', 'mouseReleased'] as const) {
          await connection.send(
            'Input.dispatchMouseEvent',
            {type, x, y, button: 'left', clickCount: 1},
            sessionId,
          );
        }
        return;
      }

      const [locator, argument] = 'type' in action ? action.type : action.key;
      const node = await nodeFor(connection, sessionId, locator);
      await connection.send('DOM.focus', {...node}, sessionId);

      if ('type' in action) {
        await connection.send('Input.insertText', {text: argument}, sessionId);
        return;
      }

      // `Enter` carries `\r` as its text, which is what a page's keypress
      // handlers and a form's implicit submission read.
      const isEnter = argument === 'Enter';
      for (const type of ['keyDown', 'keyUp'] as const) {
        await connection.send(
          'Input.dispatchKeyEvent',
          {
            type,
            key: argument,
            code: argument,
            ...(isEnter ? {text: '\r', windowsVirtualKeyCode: 13} : {}),
          },
          sessionId,
        );
      }
    },

    snapshot: async (): Promise<{dom: string; screenshot: Uint8Array}> => {
      live();
      // The app paints after load, so `checked` is reflected onto `data-checked`
      // in the page first — the markup alone never carries a DOM property.
      await evaluate(REFLECT_CHECKED);
      const document = (await connection.send('DOM.getDocument', {}, sessionId)) as {
        root?: {nodeId?: number};
      };
      const markup = (await connection.send(
        'DOM.getOuterHTML',
        {nodeId: document.root?.nodeId ?? 0},
        sessionId,
      )) as {outerHTML?: string};
      const shot = (await connection.send(
        'Page.captureScreenshot',
        {format: 'png'},
        sessionId,
      )) as {data?: string};
      return {
        dom: markup.outerHTML ?? '',
        screenshot: fromBase64(shot.data ?? ''),
      };
    },

    reload: async (): Promise<void> => {
      live();
      // Armed before the call: the load of the new document can beat a listener
      // registered after `Page.reload` returns, and `Page.reload` returns as
      // soon as the reload is under way. The cap is there because a page that
      // never fires a load event must cost a second, not the exam.
      const loaded = connection.once('Page.loadEventFired', sessionId);
      await connection.send('Page.reload', {}, sessionId);
      await Promise.race([loaded, after(RELOAD_LOAD_GRACE_MS)]);
    },

    close: async (): Promise<void> => {
      if (!open) {
        return;
      }
      open = false;
      await connection.send('Target.detachFromTarget', {sessionId}).catch(() => {});
      await connection.send('Target.closeTarget', {targetId}).catch(() => {});
    },
  };
};

/**
 * Spawns a browser and resolves once its DevTools endpoint is answering.
 *
 * `binary` defaults to `env.TINYAPP_BROWSER` and then to the image's
 * `/headless-shell/headless-shell`; `env` defaults to the process's own. A
 * binary that is not there rejects with `browser: no such binary <path>` before
 * anything is spawned, so nothing is left running behind the rejection.
 *
 * The default sandbox mode launches on the fleet image, so no `--no-sandbox` is
 * passed. A machine that needs it — a laptop, a container without user
 * namespaces — opts in through `env.TINYAPP_BROWSER_ARGS`, space-separated
 * flags appended to the argv.
 */
export const launchBrowser = async (opts?: {
  binary?: string;
  env?: Record<string, string | undefined>;
}): Promise<Browser> => {
  const env = opts?.env ?? (process.env as Record<string, string | undefined>);
  const binary = resolveBinary(opts?.binary, env);

  if (!existsSync(binary)) {
    throw new Error(`browser: no such binary ${binary}`);
  }

  const userDataDir = mkdtempSync(join(tmpdir(), 'tinyapp-browser-'));
  const extra = (env.TINYAPP_BROWSER_ARGS ?? '').split(/\s+/).filter((flag) => flag !== '');
  const argv = [
    binary,
    '--headless',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--disable-gpu',
    '--hide-scrollbars',
    ...extra,
  ];

  const child = Bun.spawn(argv, {stdout: 'ignore', stderr: 'pipe'});

  const sweep = async (): Promise<void> => {
    child.kill();
    await child.exited.catch(() => undefined);
    rmSync(userDataDir, {recursive: true, force: true});
  };

  let connection: Connection;
  try {
    connection = await connect(await devtoolsUrl(child.stderr));
  } catch (error) {
    await sweep();
    throw error;
  }

  return {
    argv,

    open: async ({html, clock}: {html: string; clock: string}): Promise<Page> => {
      const pin = clockPin(clock);
      const url = `data:text/html;base64,${Buffer.from(html, 'utf8').toString('base64')}`;
      // Checked before a target is even created: a URL over the ceiling is a
      // navigation that never lands, and waiting on it is the hang.
      if (url.length > DATA_URL_CEILING) {
        throw new Error(
          `browser: page is ${url.length} characters, over the data: URL ceiling of ${DATA_URL_CEILING}`,
        );
      }

      const created = (await connection.send('Target.createTarget', {
        url: 'about:blank',
      })) as {targetId?: string};
      const targetId = created.targetId ?? '';
      const attached = (await connection.send('Target.attachToTarget', {
        targetId,
        flatten: true,
      })) as {sessionId?: string};
      const sessionId = attached.sessionId ?? '';

      await connection.send('Network.enable', {}, sessionId);
      await connection.send('Network.setBlockedURLs', {urls: ['*']}, sessionId);
      await connection.send('Page.enable', {}, sessionId);
      await connection.send(
        'Page.addScriptToEvaluateOnNewDocument',
        {source: pin},
        sessionId,
      );

      // Armed before the navigation: the load of a `data:` URL can beat a
      // listener registered after the call returns.
      const loaded = connection.once('Page.loadEventFired', sessionId);
      await connection.send('Page.navigate', {url}, sessionId);
      await loaded;

      const page = pageOn(connection, sessionId, targetId);
      await page.evaluate(SETTLE);
      return page;
    },

    openUrl: async ({url, origin, clock, prelude, allow}): Promise<Page> => {
      const source = [clockPin(clock), prelude ?? '']
        .filter((part) => part !== '')
        .join(';\n');

      const created = (await connection.send('Target.createTarget', {
        url: 'about:blank',
      })) as {targetId?: string};
      const targetId = created.targetId ?? '';
      const attached = (await connection.send('Target.attachToTarget', {
        targetId,
        flatten: true,
      })) as {sessionId?: string};
      const sessionId = attached.sessionId ?? '';

      // A page served from an origin cannot have its every request blocked the
      // way a `data:` page can — its own document is a request. So each one is
      // paused and judged instead: continued when it is to `origin` or to one
      // of `allow`'s origins, and failed in the browser otherwise, before a byte
      // of it leaves the machine.
      await connection.send('Fetch.enable', {patterns: [{urlPattern: '*'}]}, sessionId);
      const allowed = [origin, ...(allow ?? [])].map((each) => `${each}/`);
      connection.on('Fetch.requestPaused', sessionId, (params) => {
        const {requestId, request} = params as {
          requestId?: string;
          request?: {url?: string};
        };
        const target = request?.url ?? '';
        const pass = allowed.some((prefix) => target.startsWith(prefix));
        void connection
          .send(
            pass ? 'Fetch.continueRequest' : 'Fetch.failRequest',
            pass
              ? {requestId}
              : {requestId, errorReason: 'BlockedByClient'},
            sessionId,
          )
          .catch(() => {});
      });

      await connection.send('Page.enable', {}, sessionId);
      await connection.send(
        'Page.addScriptToEvaluateOnNewDocument',
        {source},
        sessionId,
      );
      await connection.send('Page.navigate', {url}, sessionId);

      return pageOn(connection, sessionId, targetId);
    },

    close: async (): Promise<void> => {
      // Asked politely first, so the shell takes its own children down with it.
      await connection.send('Browser.close').catch(() => {});
      await Promise.race([child.exited.catch(() => undefined), after(EXIT_GRACE_MS)]);
      connection.close();
      await sweep();
    },
  };
};
