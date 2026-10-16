import { getSliceSelection, VisPanelContext } from '@h5web/lib';
import { type ArrayValue } from '@h5web/shared/hdf5-models';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  memo,
  type ReactNode,
  Suspense,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { ErrorBoundary } from 'react-error-boundary';

import { useDataContext } from '../../providers/DataProvider';
import { formatBytes, getValueSize } from '../utils';
import { isAffordable } from '../view-hints/hooks';
import { renderMarkup } from '../view-hints/markup';
import { type PanelDataset, type PanelSpec } from './models';
import PanelContent, { type PanelProps } from './PanelContent';
import Placeholder from './PanelPlaceholder';
import styles from './Panels.module.css';

interface Props extends PanelProps {
  gridRow: number;
  gridColumn: number;
  linkAxes: boolean;
  showXAxis: boolean; // e.g. only along the bottom edge of a grid
  showYAxis: boolean; // e.g. only along the left edge
  showTooltip: boolean; // e.g. not when the linked cursor's readout replaces it
  onOpen?: (spec: PanelSpec) => void; // e.g. in the normal single view
}

/* Whether the panel is in (or near) view: values are only fetched for panels once seen */
function useInView(elem: HTMLElement | null): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (!elem || inView) {
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
        }
      },
      { rootMargin: '50%' },
    );
    observer.observe(elem);
    return () => observer.disconnect();
  }, [elem, inView]);
  return inView;
}

function isAllNaN(value: unknown): boolean {
  if (!ArrayBuffer.isView(value) && !Array.isArray(value)) {
    return false;
  }
  const values = value as ArrayLike<unknown>;
  return (
    values.length > 0 &&
    Array.prototype.every.call(values, (val) => Number.isNaN(val))
  );
}

/* One panel: its title (which opens its dataset), and its values once in view */
function Panel(props: Props) {
  const {
    spec,
    gridRow,
    gridColumn,
    linkAxes,
    showXAxis,
    showYAxis,
    showTooltip,
    onOpen,
  } = props;
  const { dataset, mapping, title, linkKey } = spec;

  const dataContext = useDataContext();
  const [elem, setElem] = useState<HTMLElement | null>(null);
  const inView = useInView(elem);

  const panelOptions = useMemo(
    () => ({
      linkKey: linkAxes ? linkKey : undefined,
      axes: { x: showXAxis, y: showYAxis },
      tooltip: showTooltip,
    }),
    [linkAxes, linkKey, showXAxis, showYAxis, showTooltip],
  );

  const selection = getSliceSelection(mapping);
  const request = { dataset, selection };
  const affordable = isAffordable(dataContext, request);
  const { data, error } = useQuery({
    ...dataContext.queries.value(dataset, selection),
    enabled: inView && affordable,
    placeholderData: keepPreviousData, // previous slice while the next one loads
  });
  const value = (data ?? undefined) as
    ArrayValue<PanelDataset['type']> | undefined;
  const isEmpty = useMemo(
    () => value !== undefined && isAllNaN(value),
    [value],
  );

  function renderContent(): ReactNode {
    if (!affordable) {
      return (
        <Placeholder>
          too large to fetch ({formatBytes(getValueSize(dataset, selection))})
        </Placeholder>
      );
    }
    if (error) {
      return <Placeholder>could not be loaded</Placeholder>;
    }
    if (value === undefined) {
      return <Placeholder>{inView ? 'Loading…' : ''}</Placeholder>;
    }
    if (isEmpty) {
      return <Placeholder isEmpty />; // blank: the shape of populated panels stands out
    }
    return (
      <ErrorBoundary
        fallback={<Placeholder>could not be shown</Placeholder>}
        resetKeys={[value]}
      >
        <Suspense fallback={<Placeholder>Loading…</Placeholder>}>
          <VisPanelContext value={panelOptions}>
            <PanelContent {...props} value={value} />
          </VisPanelContext>
        </Suspense>
      </ErrorBoundary>
    );
  }

  return (
    <section
      ref={setElem}
      className={styles.panel}
      style={{ gridRow, gridColumn }}
      aria-label={title}
      data-empty={isEmpty || undefined}
    >
      <h3 className={styles.panelTitle}>
        {onOpen ? (
          <button
            type="button"
            className={styles.openBtn}
            onClick={() => onOpen(spec)}
            title="Open in a single view"
          >
            {renderMarkup(title)}
          </button>
        ) : (
          renderMarkup(title)
        )}
      </h3>
      {renderContent()}
    </section>
  );
}

export default memo(Panel);
