import { assertDefined, assertNonNull } from '@h5web/shared/guards';
import { expect, type MockInstance, vi } from 'vitest';
import { commands, type Locator, page, userEvent } from 'vitest/browser';
import { render, type RenderResult } from 'vitest-browser-react';

import App from './App';
import MockProvider from './providers/mock/MockProvider';
import { delay } from './providers/mock/utils';
import { type Vis } from './vis-packs/core/visualizations';
import { type NxDataVis } from './vis-packs/nexus/visualizations';

declare module 'vitest/browser' {
  interface BrowserCommands {
    mouseDrag: (path: [number, number][]) => Promise<void>;
  }
}

interface RenderAppResult extends RenderResult {
  user: ReturnType<typeof userEvent.setup>;
  selectExplorerNode: (name: string) => Promise<void>;
  selectNexusExplorerNode: (name: string) => Promise<void>;
  selectVisTab: (name: Vis | NxDataVis) => Promise<void>;
}

type InitialPath = `/${string}`;
interface RenderAppOpts {
  initialPath?: InitialPath;
  preferredVis?: Vis | undefined;
  waitForLoaders?: boolean;
}

export async function renderApp(
  opts: InitialPath | RenderAppOpts = '/',
): Promise<RenderAppResult> {
  const optsObj = typeof opts === 'string' ? { initialPath: opts } : opts;
  const {
    initialPath,
    preferredVis,
    waitForLoaders = true,
  }: RenderAppOpts = {
    initialPath: '/',
    ...optsObj,
  };

  if (preferredVis) {
    globalThis.localStorage.setItem(
      'h5web:preferredVis',
      JSON.stringify(preferredVis),
    );
  }

  const user = userEvent.setup();

  const renderResult = await render(
    <div style={{ height: '100vh' }}>
      <MockProvider>
        <App initialPath={initialPath} />
      </MockProvider>
    </div>,
  );

  if (waitForLoaders) {
    await waitForAllLoaders();
  }

  /* Force Playwright to initialise pointer state, making sure to restore focus afterwards.
   * https://github.com/vitest-dev/vitest/issues/9559 */
  const active = document.activeElement;
  await page.elementLocator(document.body).click();
  if (active instanceof HTMLElement) {
    active.focus();
  }

  return {
    user,
    ...renderResult,

    selectExplorerNode: async (name) => {
      await getExplorerItem(name).click();

      if (waitForLoaders) {
        await waitForAllLoaders();
      }
    },

    selectNexusExplorerNode: async (name) => {
      await getNexusExplorerItem(name).click();

      if (waitForLoaders) {
        await waitForAllLoaders();
      }
    },

    selectVisTab: async (name) => {
      await page.getByRole('tab', { name }).click();

      if (waitForLoaders) {
        await waitForAllLoaders();
      }
    },
  };
}

export async function waitForAllLoaders(): Promise<void> {
  await expect.poll(() => page.getByTestId(/^Loading/u)).toHaveLength(0);
}

export function getExplorerItem(name: string): Locator {
  return page.getByRole('treeitem', { name, exact: true });
}

export function getNexusExplorerItem(name: string): Locator {
  return page.getByRole('treeitem', {
    name: `${name} (NeXus group)`,
    exact: true,
  });
}

function getVisSelector(): Locator {
  return page.getByRole('tablist', { name: 'Visualization' });
}

export function getVisTabs(): string[] {
  return getVisSelector()
    .getByRole('tab')
    .elements()
    .map((tab) => {
      assertNonNull(tab.textContent);
      return tab.textContent;
    });
}

export function getSelectedVisTab(): string {
  const selectedTab = getVisSelector()
    .getByRole('tab')
    .elements()
    .find((tab) => tab.getAttribute('aria-selected') === 'true');

  assertDefined(selectedTab);
  assertNonNull(selectedTab.textContent);
  return selectedTab.textContent;
}

/**
 * Drag element with real mouse events: press mouse button at centre of element,
 * move pointer horizontally through the given offsets (in px), then release.
 */
export async function dragHorizontally(
  locator: Locator,
  offsets: number[],
): Promise<void> {
  const { left, top, width, height } = locator
    .element()
    .getBoundingClientRect();

  const x = left + width / 2;
  const y = top + height / 2;
  await commands.mouseDrag([
    [x, y],
    ...offsets.map((dx): [number, number] => [x + dx, y]),
  ]);
}

export function getDimMappingBtn(axis: 'x' | 'y', dim: number): Locator {
  return page
    .getByLabelText(`Dimension as ${axis} axis`)
    .getByRole('radio', { name: `D${dim}` });
}

/* Scope queries to one axis, since the same text may appear elsewhere: the
 * tooltip echoes the axis label, and `@visx/text` measures strings in a
 * `<text>` element it appends to `document.body`. */
export async function getAxis(type: 'abscissa' | 'ordinate'): Promise<Locator> {
  // The visualization may still be mounting, so wait for the axis to appear
  const axis = await vi.waitFor(() => {
    const el = document.querySelector(`svg[data-type="${type}"]`);
    assertNonNull(el, `Expected ${type} axis`);
    return el;
  });
  return page.elementLocator(axis);
}

/**
 * Mock a console method.
 * Mocks are automatically cleared and restored after every test but you
 * may also call `clearMock()` or `restoreMock()` yourself sooner as needed.
 */
export function mockConsoleMethod(
  method: 'log' | 'warn' | 'error',
  debug?: boolean,
): MockInstance {
  return vi.spyOn(console, method).mockImplementation((...args) => {
    if (debug) {
      console.debug(...args); // eslint-disable-line no-console
    }
  });
}

export function mockDelay(): () => void {
  let resolves: (() => void)[] = [];

  vi.mocked(delay).mockImplementation(
    async (abortSignal = new AbortController().signal) => {
      return new Promise<void>((resolve, reject) => {
        function handleAbort() {
          abortSignal.removeEventListener('abort', handleAbort);
          reject(abortSignal.reason); // eslint-disable-line @typescript-eslint/prefer-promise-reject-errors
        }

        abortSignal.addEventListener('abort', handleAbort);

        resolves.push(() => {
          abortSignal.removeEventListener('abort', handleAbort);
          resolve();
        });
      });
    },
  );

  function runAll() {
    resolves.forEach((resolve) => {
      resolve();
    });
    resolves = [];
  }

  return runAll;
}

export async function flushTasks() {
  // Let React render (its scheduler relies on `MessageChannel`, which isn't faked)
  for (let i = 0; i < 3; i += 1) {
    // eslint-disable-next-line no-await-in-loop -- sequential tasks
    await new Promise<void>((resolve) => {
      const channel = new MessageChannel();
      channel.port1.addEventListener('message', () => resolve(), {
        once: true,
      });
      channel.port1.start();
      channel.port2.postMessage(undefined); // eslint-disable-line unicorn/require-post-message-target-origin -- not a window
    });
  }
}

/* Advance fake timers in small steps, letting tasks that aren't faked run in between (e.g.
 * rendering, resolving fetched values) as they would in real time */
export async function advanceFakeTimers(ms: number) {
  for (let elapsed = 0; elapsed < ms; elapsed += 25) {
    await vi.advanceTimersByTimeAsync(Math.min(25, ms - elapsed)); // eslint-disable-line no-await-in-loop -- sequential steps
    await flushTasks(); // eslint-disable-line no-await-in-loop -- sequential steps
  }
}
