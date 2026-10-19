import {
  DataCurve,
  getKnotSpans,
  getSpanSteps,
  INTERPOLATORS,
  type KnotVector,
  LineVis,
  sampleBasis,
} from '@h5web/lib';
import { type NumArray } from '@h5web/shared/vis-models';
import { formatTooltipVal } from '@h5web/shared/vis-utils';
import ndarray from 'ndarray';
import { useMemo } from 'react';

import { toUnicodeScripts } from '../view-hints/attrs';
import { renderSvgMarkup } from '../view-hints/markup';
import styles from './NurbsBasis.module.css';
import NurbsBasisLegend, { type BasisLegendEntry } from './NurbsBasisLegend';
import NurbsKnotMarks from './NurbsKnotMarks';

const SAMPLES_PER_SPAN = 64;
const MAX_VALUES = 2 ** 22; // fewer samples per span beyond this (many control points)
const MAX_FUNCTIONS = 256;
const HEADROOM = 0.25; // above 1, for the legend and knot labels
const MAX_LEGEND_FUNCTIONS = 12; // beyond, the tooltip names the functions

// d3 `schemeTableau10`, then hues of the Turbo colour map in golden-ratio steps
// prettier-ignore
const TABLEAU10 = [
  '#4e79a7', '#f28e2c', '#e15759', '#76b7b2', '#59a14f',
  '#edc949', '#af7aa1', '#ff9da7', '#9c755f', '#bab0ab',
];
const GOLDEN_RATIO = (Math.sqrt(5) - 1) / 2;
const SUM_COLOR = 'gray';
const interpolateTurbo = INTERPOLATORS.Turbo;

function getBasisColor(i: number): string {
  return i < TABLEAU10.length
    ? TABLEAU10[i]
    : interpolateTurbo(0.1 + 0.8 * ((i * GOLDEN_RATIO) % 1));
}

interface Props {
  className: string;
  title: string;
  vector: KnotVector;
  weights?: NumArray; // rational basis functions
  param: string; // `u` or `v`
  showSum: boolean;
  showGrid: boolean;
}

/* Basis functions `N(i,p)` (or `R(i,p)`) of all control points over the domain, with the knots */
function NurbsBasisPlot(props: Props) {
  const { className, title, vector, weights, param, showSum, showGrid } = props;
  const { degree, knots } = vector;
  const count = knots.length - degree - 1;
  if (count > MAX_FUNCTIONS) {
    throw new Error(
      `Too many control points to plot their basis functions (${count}, at most ${MAX_FUNCTIONS})`,
    );
  }

  const { params, basis, sum } = useMemo(() => {
    const spans = getKnotSpans(vector);
    const samples = Math.max(
      Math.min(
        Math.floor(MAX_VALUES / (count * spans.length)),
        SAMPLES_PER_SPAN,
      ),
      4,
    );
    const steps = getSpanSteps(
      spans,
      new Uint32Array(spans.length).fill(samples),
    );
    const values = sampleBasis(vector, steps, weights);
    return {
      params: steps.params,
      basis: values,
      sum: steps.params.map((_, s) =>
        values.reduce((acc, arr) => acc + arr[s], 0),
      ),
    };
  }, [vector, weights, count]);

  const letter = weights ? 'R' : 'N';
  const entries = useMemo(
    (): BasisLegendEntry[] => [
      ...basis.map((_, i) => ({
        label: toUnicodeScripts(`${letter}_{${i}}`) ?? '',
        color: getBasisColor(i),
      })),
      ...(showSum ? [{ label: 'Σ', color: SUM_COLOR, dash: true }] : []),
    ],
    [basis, letter, showSum],
  );
  const firstArray = useMemo(() => ndarray(basis[0]), [basis]);

  return (
    <LineVis
      className={className}
      title={title}
      dataArray={firstArray}
      dataColor={entries[0].color}
      domain={[0, 1 + HEADROOM]}
      abscissaParams={{ value: params, label: param }}
      ordinateLabel={renderSvgMarkup(`${letter}_{i,${degree}}(${param})`)}
      showGrid={showGrid}
      renderTooltip={({ xi }) => (
        <>
          {`${param} = ${formatTooltipVal(params[xi])}`}
          {basis.map(
            (values, i) =>
              values[xi] > 0 && (
                // eslint-disable-next-line react/no-array-index-key
                <div key={i} className={styles.tooltipItem}>
                  <span
                    className={styles.swatch}
                    data-keep-colors
                    style={{ color: entries[i].color }}
                  />
                  {`${entries[i].label} = ${formatTooltipVal(values[xi])}`}
                </div>
              ),
          )}
        </>
      )}
    >
      {basis.slice(1).map((values, i) => (
        <DataCurve
          // eslint-disable-next-line react/no-array-index-key
          key={i}
          abscissas={params}
          ordinates={values}
          color={entries[i + 1].color}
        />
      ))}
      {showSum && (
        <DataCurve
          abscissas={params}
          ordinates={sum}
          color={SUM_COLOR}
          width={2}
          dash
        />
      )}
      <NurbsKnotMarks vector={vector} />
      <NurbsBasisLegend
        entries={
          count > MAX_LEGEND_FUNCTIONS ? entries.slice(basis.length) : entries
        }
      />
    </LineVis>
  );
}

export default NurbsBasisPlot;
