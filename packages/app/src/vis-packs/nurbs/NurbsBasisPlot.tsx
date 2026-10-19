import {
  getKnotSpans,
  getSpanSteps,
  type KnotVector,
  LineVis,
  sampleBasis,
} from '@h5web/lib';
import { type NumArray } from '@h5web/shared/vis-models';
import ndarray from 'ndarray';
import { useMemo } from 'react';

import { toUnicodeScripts } from '../view-hints/attrs';
import { renderSvgMarkup } from '../view-hints/markup';
import NurbsKnotMarks from './NurbsKnotMarks';

const SAMPLES_PER_SPAN = 64;
const MAX_VALUES = 2 ** 22; // fewer samples per span beyond this (many control points)
const MAX_FUNCTIONS = 256;

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
      basis: values.map((arr) => ndarray(arr)),
      sum: ndarray(
        steps.params.map((_, s) =>
          values.reduce((acc, arr) => acc + arr[s], 0),
        ),
      ),
    };
  }, [vector, weights, count]);

  const letter = weights ? 'R' : 'N';
  const auxiliaries = useMemo(
    () => [
      ...basis.slice(1).map((array, i) => ({
        array,
        label: toUnicodeScripts(`${letter}_{${i + 1}}`),
        visible: true,
      })),
      ...(showSum
        ? [{ array: sum, label: 'Σ', dash: true, visible: true }]
        : []),
    ],
    [basis, letter, showSum, sum],
  );

  return (
    <LineVis
      className={className}
      title={title}
      dataArray={basis[0]}
      dataLabel={toUnicodeScripts(`${letter}_{0}`)}
      domain={[0, 1]}
      abscissaParams={{ value: params, label: param }}
      ordinateLabel={renderSvgMarkup(`${letter}_{i,${degree}}(${param})`)}
      auxiliaries={auxiliaries}
      showGrid={showGrid}
      showLegend
    >
      <NurbsKnotMarks vector={vector} />
    </LineVis>
  );
}

export default NurbsBasisPlot;
