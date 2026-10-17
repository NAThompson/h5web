import { getAxisOffsets, MultiVisCanvas } from '@h5web/lib';
import { type Domain, ScaleType } from '@h5web/shared/vis-models';
import { useMeasure } from '@react-hookz/web';
import {
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';

import { type ViewHint } from '../view-hints/models';
import { getColorSuggestions } from '../view-hints/suggestions';
import { createCursorStore } from './cursor';
import CursorReadout from './CursorReadout';
import FacetHeaders from './FacetHeaders';
import { type PanelSpec } from './models';
import Panel from './Panel';
import { type PanelColors } from './PanelContent';
import styles from './Panels.module.css';
import SharedAxisLabels from './SharedAxisLabels';
import SharedColorBar from './SharedColorBar';
import {
  combineDomains,
  getBottomRows,
  getColorGroup,
  MAX_LISTED_VALUES,
  SNAPSHOT_MAX_PANELS,
} from './utils';

const DOMAIN_UPDATE_DELAY = 150; // ms: domains of panels loading together are combined at once
const PENDING_COLORS: PanelColors = { domain: [0, 1] }; // until the first panel of a group loads

const MIN_SIZE = 192; // px: of a panel with axes (more panels than fit: scroll)
const MIN_COMPACT_SIZE = 80; // px: of a panel without axes
const COMPACT_PLOT_SIZE = 200; // px: smaller plots are drawn compact (cf. `isCompact`)
const LABEL_SIZE = 24; // px: shared axis labels
const GAP = 8; // px, between panels and around the grid
const TITLE_HEIGHT = 24; // px: of panel titles, and column headers
const ROW_HEADER_WIDTH = 20; // px: vertical text
const AXES = getAxisOffsets({ left: true, bottom: true }); // with labels
const SNAPSHOT_TIMEOUT = 30_000; // ms: to load the panels out of view

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/* Once the panels in `root` have loaded (or after a timeout) and are drawn */
async function whenLoaded(root: HTMLElement, start = performance.now()) {
  await delay(50);
  if (
    root.querySelector('[data-pending]') &&
    performance.now() - start < SNAPSHOT_TIMEOUT
  ) {
    await whenLoaded(root, start);
    return;
  }
  await delay(DOMAIN_UPDATE_DELAY); // shared domains of the panels
  await nextFrame();
  await nextFrame();
}

export interface PanelGridHandle {
  /* Load all panels, also those out of view (the first `SNAPSHOT_MAX_PANELS`), and wait for them */
  prepareSnapshot: () => Promise<void>;
}

/* Size of the panels (square, besides their title, and axes and headers along the edges of the
 * grid): as large as fit the available area, else as the columns fit its width (the grid then
 * scrolls down) */
function getPanelSize(
  [cols, rows]: [number, number],
  [width, height]: [number, number],
  [extraWidth, extraHeight]: [number, number],
  titleHeight: number,
  min: number,
): number {
  const colFit = (width - extraWidth - GAP * (cols + 1)) / cols;
  const rowFit =
    (height - extraHeight - (GAP + titleHeight) * rows - GAP) / rows;
  const fit = Math.min(colFit, rowFit);
  return Math.floor(fit >= min ? fit : Math.max(min, colFit));
}

/* Total size of tracks of the grid (e.g. labels), with the gaps after them */
function sumTracks(sizes: number[]): number {
  return sizes.reduce((acc, size) => acc + size + GAP, 0);
}

/* Sizes of the columns or rows of the grid, with `extra` on some of them (e.g. axes) */
function getTracks(
  count: number,
  size: number,
  extra: number,
  extraIndices: number[],
): string {
  return Array.from(
    { length: count },
    (_, i) => `${size + (extraIndices.includes(i) ? extra : 0)}px`,
  ).join(' ');
}

/* Shared domain of a group of panels, and colour map (e.g. diverging if it spans the centre),
 * as one panel's hint says, given the domain of their values and the domain hinted for them */
function getGroupColors(
  hint: ViewHint,
  dataDomain: Domain,
  domainHint: ViewHint['domain'],
  centerHint: number | undefined,
): PanelColors {
  const scaleType = hint.scaleType ?? ScaleType.Linear;
  const canBeSymmetric =
    scaleType === ScaleType.Linear || scaleType === ScaleType.SymLog;
  const domain =
    domainHint === 'symmetric' && !canBeSymmetric
      ? undefined
      : (domainHint ?? hint.domain);
  const { colorMap, customDomain } = getColorSuggestions(
    { ...hint, domain, center: centerHint ?? hint.center },
    dataDomain,
  );
  const [min, max] = customDomain ?? [null, null];
  return { domain: [min ?? dataDomain[0], max ?? dataDomain[1]], colorMap };
}

interface Props {
  name: string; // e.g. of the group or dataset (snapshot file names)
  specs: PanelSpec[];
  rows: number;
  cols: number;
  isDomainShared: boolean;
  domainHint?: ViewHint['domain']; // of the shared domain (e.g. symmetric)
  centerHint?: number; // of a symmetric shared domain
  linkAxes: boolean;
  linkCursor: boolean;
  edgeAxesOnly: boolean; // axes only along the left and bottom edges of the grid (compact)
  axisLabels?: { x?: string; y?: string }; // shared by all panels: once, beside the grid
  headers?: { rows: string[]; cols: string[] }; // facet grid: instead of panel titles
  footer?: ReactNode; // below the grid (e.g. legend of overlays)
  onOpen?: (spec: PanelSpec) => void;
  className?: string;
  ref?: Ref<PanelGridHandle>;
}

/* Panels in a grid, drawn in a single canvas, with a colour bar per shared domain */
function PanelGrid(props: Props) {
  const {
    name,
    specs,
    rows,
    cols,
    isDomainShared,
    domainHint,
    centerHint,
    linkAxes,
    linkCursor,
    edgeAxesOnly,
    axisLabels,
    headers,
    footer,
    onOpen,
    className = '',
    ref,
  } = props;

  const rootRef = useRef<HTMLDivElement>(null);
  const [loadAll, setLoadAll] = useState(false);
  useImperativeHandle(
    ref,
    () => ({
      prepareSnapshot: async () => {
        setLoadAll(true);
        await nextFrame(); // panels loading
        await nextFrame();
        if (rootRef.current) {
          await whenLoaded(rootRef.current);
        }
      },
    }),
    [],
  );

  // Data domains of the panels, combined once those loading together have reported theirs
  const domains = useRef(new Map<string, Domain>());
  const [domainsVersion, setDomainsVersion] = useState(0);
  const timeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const onDataDomainChange = useCallback(
    (key: string, domain: Domain | undefined) => {
      const prev = domains.current.get(key);
      if (prev?.[0] === domain?.[0] && prev?.[1] === domain?.[1]) {
        return;
      }
      if (domain) {
        domains.current.set(key, domain);
      } else {
        domains.current.delete(key);
      }
      if (timeout.current === undefined) {
        timeout.current = setTimeout(() => {
          timeout.current = undefined;
          setDomainsVersion((v) => v + 1);
        }, DOMAIN_UPDATE_DELAY);
      }
    },
    [],
  );
  useEffect(() => () => clearTimeout(timeout.current), []);

  const groups = useMemo(() => {
    const byGroup = new Map<string, PanelSpec[]>();
    specs.forEach((spec) => {
      const group = getColorGroup(spec);
      if (group !== undefined) {
        byGroup.set(group, [...(byGroup.get(group) ?? []), spec]);
      }
    });
    return byGroup;
  }, [specs]);

  const groupColors = useMemo(() => {
    const colors = new Map<string, PanelColors>();
    if (!isDomainShared) {
      return colors;
    }
    groups.forEach((members, group) => {
      const dataDomain = combineDomains(
        members.map(({ key }) => domains.current.get(key)),
      );
      if (dataDomain) {
        colors.set(
          group,
          getGroupColors(members[0].hint, dataDomain, domainHint, centerHint),
        );
      }
    });
    return colors;
  }, [groups, isDomainShared, domainHint, centerHint, domainsVersion]); // eslint-disable-line react-hooks/exhaustive-deps -- domains in a ref, versioned

  const [cursorStore] = useState(createCursorStore);
  const [size, sizeRef] = useMeasure<HTMLDivElement>();
  const { width = 0, height = 0 } = size ?? {};
  const labelSize = axisLabels ? LABEL_SIZE : 0;
  const [axesWidth, axesHeight] = edgeAxesOnly
    ? [AXES.left, AXES.bottom]
    : [0, 0];
  const bottomRows = useMemo(() => getBottomRows(specs), [specs]); // with x axes
  const axisRows = new Set(bottomRows.values());
  // Facet grid: headers along the edges instead of panel titles
  const [rowHeader, colHeader, titleHeight] = headers
    ? [ROW_HEADER_WIDTH, TITLE_HEIGHT, 0]
    : [0, 0, TITLE_HEIGHT];
  // Tracks around the panels: shared y label and row headers; column headers; x label
  const leadCols = [labelSize, rowHeader].filter(Boolean);
  const leadRows = [colHeader].filter(Boolean);
  const trailRows = [labelSize].filter(Boolean);
  const panelSize = getPanelSize(
    [cols, rows],
    [width, height],
    [
      axesWidth + sumTracks(leadCols),
      axesHeight * axisRows.size + sumTracks([...leadRows, ...trailRows]),
    ],
    titleHeight,
    edgeAxesOnly ? MIN_COMPACT_SIZE : MIN_SIZE,
  );
  const plotSize = edgeAxesOnly
    ? panelSize - AXES.right
    : panelSize - AXES.left - AXES.right;
  const isCompact = plotSize < COMPACT_PLOT_SIZE;
  // Linked cursor's values in a readout, instead of a tooltip (small panels, small multiples)
  const withReadout = linkCursor && (edgeAxesOnly || isCompact);
  const listValues = withReadout && specs.length <= MAX_LISTED_VALUES;
  const [rowOffset, colOffset] = [leadRows.length, leadCols.length];

  return (
    <div
      ref={rootRef}
      className={`${styles.root} ${className}`}
      role="group"
      aria-label={name}
      data-snapshot-root // cf. `SNAPSHOT_ROOT_ATTR`: grid and colour bars
    >
      <div className={styles.canvas}>
        {withReadout && (
          <CursorReadout
            store={cursorStore}
            axisLabels={axisLabels ?? {}}
            panels={specs}
          />
        )}
        <div ref={sizeRef} className={styles.canvasArea}>
          <MultiVisCanvas>
            <div
              className={styles.grid}
              style={{
                gap: GAP,
                padding: GAP,
                gridTemplateColumns: [
                  ...leadCols.map((px) => `${px}px`),
                  getTracks(cols, panelSize, axesWidth, [0]),
                ].join(' '),
                gridTemplateRows: [
                  ...leadRows.map((px) => `${px}px`),
                  getTracks(rows, panelSize + titleHeight, axesHeight, [
                    ...axisRows,
                  ]),
                  ...trailRows.map((px) => `${px}px`),
                ].join(' '),
              }}
              data-shared-labels={!!axisLabels || undefined}
            >
              {axisLabels && (
                <SharedAxisLabels
                  labels={axisLabels}
                  rows={rows}
                  cols={cols}
                  start={[rowOffset + 1, colOffset + 1]}
                  visibleSize={[width - 2 * GAP, height - 2 * GAP]}
                />
              )}
              {headers && (
                <FacetHeaders
                  headers={headers}
                  rows={rows}
                  cols={cols}
                  start={[rowOffset + 1, colOffset + 1]}
                  axesSize={[axesWidth, axesHeight]}
                  axisRows={axisRows}
                />
              )}
              {specs.map((spec, index) => {
                const group = getColorGroup(spec);
                return (
                  <Panel
                    key={spec.key}
                    spec={spec}
                    gridRow={spec.row + rowOffset + 1}
                    gridColumn={spec.col + colOffset + 1}
                    colors={
                      isDomainShared && group !== undefined
                        ? (groupColors.get(group) ?? PENDING_COLORS)
                        : undefined
                    }
                    linkAxes={linkAxes}
                    cursorStore={linkCursor ? cursorStore : undefined}
                    showXAxis={
                      !edgeAxesOnly || spec.row === bottomRows.get(spec.col)
                    }
                    axisBand={axisRows.has(spec.row) ? axesHeight : 0}
                    showYAxis={!edgeAxesOnly || spec.col === 0}
                    showTitle={!headers}
                    showTooltip={!withReadout}
                    load={loadAll && index < SNAPSHOT_MAX_PANELS}
                    isCompact={isCompact}
                    reportValue={listValues}
                    onDataDomainChange={onDataDomainChange}
                    onOpen={onOpen}
                  />
                );
              })}
            </div>
          </MultiVisCanvas>
        </div>
        {footer}
      </div>
      {isDomainShared && groupColors.size > 0 && (
        <div className={styles.colorBars}>
          {[...groupColors].map(([group, colors]) => {
            const spec = groups.get(group)?.[0];
            return (
              spec && <SharedColorBar key={group} spec={spec} colors={colors} />
            );
          })}
        </div>
      )}
    </div>
  );
}

export default PanelGrid;
