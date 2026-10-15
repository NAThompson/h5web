import { type IgnoreValue, type NumArray } from '@h5web/shared/vis-models';
import ndarray, { type NdArray } from 'ndarray';
import { useMemo } from 'react';

import { getRows } from '../core/line/utils';
import { type Envelope } from './models';

/* Running min / max along the last axis (each curve of a multi-plot): NaN and ignored values are
 * skipped, the envelope carried over them (NaN before the first value) */
export function getEnvelope(
  array: NdArray<NumArray>,
  envelope: Envelope,
  ignoreValue?: IgnoreValue,
): NdArray<NumArray> {
  const { data, shape } = array;
  const length = shape.at(-1) ?? 0;
  const pick = envelope.type === 'cummin' ? Math.min : Math.max;
  const env = new Float64Array(data.length);

  for (let start = 0; start < data.length; start += length) {
    let current = Number.NaN;
    for (let k = 0; k < length; k += 1) {
      const i = start + (envelope.reverse ? length - 1 - k : k);
      const val = data[i];
      if (!Number.isNaN(val) && !ignoreValue?.(val)) {
        current = Number.isNaN(current) ? val : pick(current, val);
      }
      env[i] = current;
    }
  }

  return ndarray(env, shape);
}

function getEnvelopeLabel({ type, reverse }: Envelope): string {
  return `running ${type === 'cummin' ? 'min' : 'max'}${reverse ? ' (from the end)' : ''}`;
}

/* Mapped array of a line vis with its envelope: instead of the data (`replace`), or as extra
 * curves (`add`: one per curve of a multi-plot) */
export function useEnvelopes(
  mappedArray: NdArray<NumArray>,
  envelope: Envelope | undefined,
  isMultiPlot: boolean,
  ignoreValue: IgnoreValue | undefined,
): {
  array: NdArray<NumArray>;
  envelopes: NdArray<NumArray>[];
  envelopeLabel: string;
} {
  return useMemo(() => {
    if (!envelope) {
      return { array: mappedArray, envelopes: [], envelopeLabel: '' };
    }
    const env = getEnvelope(mappedArray, envelope, ignoreValue);
    const isAdded = envelope.mode === 'add';
    return {
      array: isAdded ? mappedArray : env,
      envelopes: !isAdded ? [] : isMultiPlot ? getRows(env) : [env],
      envelopeLabel: getEnvelopeLabel(envelope),
    };
  }, [mappedArray, envelope, isMultiPlot, ignoreValue]);
}
