import { getAxisOffsets, MultiVisCanvas } from '@h5web/lib';
import { type Domain, ScaleType } from '@h5web/shared/vis-models';
import { useMeasure } from '@react-hookz/web';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { type ViewHint } from '../view-hints/models';
import { getColorSuggestions } from '../view-hints/suggestions';
import { createCursorStore } from './cursor';
import CursorReadout from './CursorReadout';
import { type PanelSpec } from './models';
import Panel from './Panel';
import { type PanelColors } from './PanelContent';
import styles from './Panels.module.css';
import SharedAxisLabels from './SharedAxisLabels';
import SharedColorBar from './SharedColorBar';
import { combineDomains } from './utils';

const DOMAIN_UPDATE_DELAY = 150; // ms: domains of panels loading together are combined at once
const PENDING_COLORS: PanelColors = { domain: [0, 1] }; // until the first panel of a group loads

const MIN_SIZE = 192; // px: of a panel with axes (more panels than fit: scroll)
const MIN_COMPACT_SIZE = 96; // px: of a panel without axes
const COMPACT_PLOT_SIZE = 200; // px: smaller plots are drawn compact (cf. `isCompact`)
const LABEL_SIZE = 24; // px: shared axis labels
const GAP = 8; // px, between panels and around the grid
const TITLE_HEIGHT = 24; // px
const AXES = getAxisOffsets({ left: true, bottom: true }); // with labels

/* Size of the panels (square, besides their title and axes along the edges of the grid): as large
 * as fit the available area, else as the columns fit its width (the grid then scrolls down) */
function getPanelSize(
  [cols, rows]: [number, number],
  [width, height]: [number, number],
  [axesWidth, axesHeight]: [number, number],
  min: number,
): number {
  const colFit = (width - axesWidth - GAP * (cols + 1)) / cols;
  const rowFit =
    (height - axesHeight - (GAP + TITLE_HEIGHT) * rows - GAP) / rows;
  const fit = Math.min(colFit, rowFit);
  return Math.floor(fit >= min ? fit : Math.max(min, colFit));
}

/* Sizes of the columns or rows of the grid, with `extra` on one of them (e.g. axes) */
function getTracks(
  count: number,
  size: number,
  extra: number,
  extraIndex: number,
): string {
  return Array.from(
    { length: count },
    (_, i) => `${size + (i === extraIndex ? extra : 0)}px`,
  ).join(' ');
}

/* Heatmap panels whose colours can be shared: same colour scale */
function getColorGroup(spec: PanelSpec): string | undefined {
  return spec.kind === 'heatmap'
    ? (spec.hint.scaleType ?? ScaleType.Linear)
    : undefined;
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
  onOpen?: (spec: PanelSpec) => void;
  className?: string;
}

/* Panels in a grid, drawn in a single canvas, with a colour bar per shared domain */
function PanelGrid(props: Props) {
  const {
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
    onOpen,
    className = '',
  } = props;

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
  const panelSize = getPanelSize(
    [cols, rows],
    [width - labelSize, height - labelSize],
    [axesWidth, axesHeight],
    edgeAxesOnly ? MIN_COMPACT_SIZE : MIN_SIZE,
  );
  const plotSize = edgeAxesOnly
    ? panelSize - AXES.right
    : panelSize - AXES.left - AXES.right;
  const isCompact = plotSize < COMPACT_PLOT_SIZE;
  // Linked cursor's values in a readout, instead of a tooltip (small panels, small multiples)
  const withReadout = linkCursor && (edgeAxesOnly || isCompact);
  const colOffset = labelSize > 0 ? 1 : 0; // after the shared y label

  return (
    <div className={`${styles.root} ${className}`}>
      <div className={styles.canvas}>
        {withReadout && (
          <CursorReadout store={cursorStore} axisLabels={axisLabels ?? {}} />
        )}
        <div ref={sizeRef} className={styles.canvasArea}>
          <MultiVisCanvas>
            <div
              className={styles.grid}
              style={{
                gap: GAP,
                padding: GAP,
                gridTemplateColumns: [
                  labelSize > 0 && `${labelSize}px`,
                  getTracks(cols, panelSize, axesWidth, 0),
                ]
                  .filter(Boolean)
                  .join(' '),
                gridTemplateRows: [
                  getTracks(
                    rows,
                    panelSize + TITLE_HEIGHT,
                    axesHeight,
                    rows - 1,
                  ),
                  labelSize > 0 && `${labelSize}px`,
                ]
                  .filter(Boolean)
                  .join(' '),
              }}
              data-shared-labels={!!axisLabels || undefined}
            >
              {axisLabels && (
                <SharedAxisLabels
                  labels={axisLabels}
                  rows={rows}
                  cols={cols}
                  visibleSize={[width - 2 * GAP, height - 2 * GAP]}
                />
              )}
              {specs.map((spec) => {
                const group = getColorGroup(spec);
                return (
                  <Panel
                    key={spec.key}
                    spec={spec}
                    gridRow={spec.row + 1}
                    gridColumn={spec.col + colOffset + 1}
                    colors={
                      isDomainShared && group !== undefined
                        ? (groupColors.get(group) ?? PENDING_COLORS)
                        : undefined
                    }
                    linkAxes={linkAxes}
                    cursorStore={linkCursor ? cursorStore : undefined}
                    showXAxis={!edgeAxesOnly || spec.row === rows - 1}
                    showYAxis={!edgeAxesOnly || spec.col === 0}
                    showTooltip={!withReadout}
                    isCompact={isCompact}
                    onDataDomainChange={onDataDomainChange}
                    onOpen={onOpen}
                  />
                );
              })}
            </div>
          </MultiVisCanvas>
        </div>
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
