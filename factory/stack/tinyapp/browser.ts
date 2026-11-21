import {existsSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// Borrowed from popmechanic/tinyapp-fixture packages/tinyapp-exam/src/browser.ts
// at d71c037 (2026-09-27); the two sibling imports are inlined below.
export type Locator = {role: string; name: string};
export type Action =
  | {click: Locator}
  | {type: [Locator, string]}
  | {key: [Locator, string]}
  | {select: [Locator, string]};

const DEFAULT_BINARY = '/headless-shell/headless-shell';

const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const resolveBinary = (
  explicit?: string,
  env: Record<string, string | undefined> = process.env,
): string => {
  if (explicit) return explicit;
  if (env.TINYAPP_BROWSER) return env.TINYAPP_BROWSER;
  return existsSync(DEFAULT_BINARY) ? DEFAULT_BINARY : MAC_CHROME;
};

const DEVTOOLS_LINE = /DevTools listening on (ws:\S+)/;

const DEVTOOLS_TIMEOUT_MS = 15_000;

const CALL_TIMEOUT_MS = 30_000;

const EXIT_GRACE_MS = 2_000;

const SELECT_OPEN_MS = 2_000;

export interface Page {
  act(action: Action): Promise<void>;
  evaluate(expression: string): Promise<unknown>;
  count(locator: {role: string; name: string}): Promise<number>;
  close(): Promise<void>;
}

export interface Browser {
  readonly argv: string[];
  openUrl(opts: {
    url: string;
    origin: string;
    clock: string;
    prelude?: string;
    allow?: string[];
  }): Promise<Page>;
  close(): Promise<void>;
}

type Incoming = {
  id?: number;
  result?: Record<string, unknown>;
  error?: {message?: string; code?: number};
  method?: string;
  params?: Record<string, unknown>;
  sessionId?: string;
};

type Connection = {
  send(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
  ): Promise<Record<string, unknown>>;
  on(
    method: string,
    sessionId: string,
    handler: (params: Record<string, unknown>) => void,
  ): void;
  close(): void;
};

const after = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    (timer as unknown as {unref?: () => void}).unref?.();
  });

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

const connect = async (url: string): Promise<Connection> => {
  const socket = new WebSocket(url);
  const pending = new Map<
    number,
    {resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void}
  >();
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
    on: (method, sessionId, handler) => {
      const key = `${sessionId} ${method}`;
      listeners.set(key, [...(listeners.get(key) ?? []), handler]);
    },
    close: () => socket.close(),
  };
};

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

type NodeRef = {backendNodeId: number};

const spellLocator = (locator: Locator): string =>
  `role=${locator.role} name=${JSON.stringify(locator.name)}`;

const rootOf = async (connection: Connection, sessionId: string): Promise<number> => {
  const document = (await connection.send('DOM.getDocument', {}, sessionId)) as {
    root?: {nodeId?: number};
  };
  return document.root?.nodeId ?? 0;
};

const nodeFor = async (
  connection: Connection,
  sessionId: string,
  locator: Locator,
): Promise<NodeRef> => {
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

  const clickNode = async (node: NodeRef): Promise<void> => {
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
  };

  const optionFor = async (name: string, ms: number): Promise<NodeRef | undefined> => {
    const end = Date.now() + ms;
    for (;;) {
      await connection.send('Accessibility.enable', {}, sessionId);
      const found = (await connection.send('Accessibility.queryAXTree', {
        nodeId: await rootOf(connection, sessionId),
        role: 'option',
        accessibleName: name,
      }, sessionId)) as {nodes?: {backendDOMNodeId?: number; ignored?: boolean}[]};
      const backendNodeId = (found.nodes ?? []).find(
        (n) => !n.ignored && (n.backendDOMNodeId ?? 0) !== 0)?.backendDOMNodeId;
      if (backendNodeId !== undefined) return {backendNodeId};
      if (Date.now() > end) return undefined;
      await after(50);
    }
  };

  return {
    evaluate,

    count: async (locator) => {
      if (locator.role === 'text') {
        return (await evaluate(`(() => {
          const want = ${JSON.stringify(locator.name)};
          const root = document.getElementById('app') ?? document.body;
          let n = 0;
          for (const el of root.querySelectorAll('[data-part="text"]')) {
            if ((el.textContent ?? '').replace(/\\s+/g, ' ').trim() === want) n++;
          }
          return n;
        })()`)) as number;
      }
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
        await clickNode(await nodeFor(connection, sessionId, action.click));
        return;
      }

      if ('select' in action) {
        const [locator, option] = action.select;
        const combobox = await nodeFor(connection, sessionId, locator);
        await clickNode(combobox);
        let found = await optionFor(option, SELECT_OPEN_MS);
        if (found === undefined) {
          await connection.send('DOM.focus', {...combobox}, sessionId).catch(() => undefined);
          for (const type of ['keyDown', 'keyUp'] as const) {
            await connection.send(
              'Input.dispatchKeyEvent',
              {type, key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40},
              sessionId,
            );
          }
          found = await optionFor(option, SELECT_OPEN_MS);
        }
        if (found === undefined) {
          throw new Error(
            `act: no option ${JSON.stringify(option)} in combobox ${JSON.stringify(locator.name)}`,
          );
        }
        await clickNode(found);
        const end = Date.now() + SELECT_OPEN_MS;
        for (;;) {
          const open = (await connection.send('Accessibility.queryAXTree', {
            nodeId: await rootOf(connection, sessionId),
            role: 'listbox',
          }, sessionId)) as {nodes?: {backendDOMNodeId?: number; ignored?: boolean}[]};
          if (!(open.nodes ?? []).some((n) => !n.ignored && (n.backendDOMNodeId ?? 0) !== 0)) break;
          if (Date.now() > end) break;
          await after(50);
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
      await connection.send('Browser.close').catch(() => {});
      await Promise.race([child.exited.catch(() => undefined), after(EXIT_GRACE_MS)]);
      connection.close();
      await sweep();
    },
  };
};
