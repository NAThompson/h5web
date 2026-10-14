import { type Domain } from '@h5web/shared/vis-models';
import { createContext, useContext, useEffect, useMemo } from 'react';

/* Value range to use while playing through a sequence of slices (cf. `PlaybackRange` setting):
 * the range of the whole sequence when its values are known, otherwise the range of the slices
 * shown so far. Provided by containers (from `useSlicingProps`), used by mapped visualizations
 * in place of the current slice's data domain. */
export interface PlaybackRangeValue {
  key: string; // identifies the sequence; ranges are reset when it changes
  sequenceValue: unknown; // values of all slices of the sequence, provided briefly once fetched
  sequenceDomains: Map<string, Domain>; // range of whole sequence, per kind of domain
  seenDomains: Map<string, Domain>; // range of slices shown so far, per kind of domain
  computedKinds: Set<string>; // kinds of domain computed from sequence's values (even if none)
  requestSequence?: () => void; // fetch sequence's values again (e.g. for new kind of domain)
  loading?: { queryHash: string; cancel: () => void }; // while fetching whole sequence
}

export const PlaybackRangeContext = createContext<
  PlaybackRangeValue | undefined
>(undefined);

export function extendDomain(
  domain: Domain | undefined,
  other: Domain | undefined,
): Domain | undefined {
  if (!domain || !other) {
    return domain ?? other;
  }
  return [Math.min(domain[0], other[0]), Math.max(domain[1], other[1])];
}

/* Stable data domain while playing (or after playing until the sequence changes); returns
 * `frameDomain` otherwise. `kind` identifies how domains are computed (e.g. scale type,
 * complex vis type), so that only comparable domains get combined; `getSequenceDomain`
 * computes the domain of the whole sequence's values the same way. Custom domains are
 * applied on top by the caller, so they always win. */
export function useStableDomain(
  frameDomain: Domain | undefined,
  kind: string,
  getSequenceDomain: (sequenceValue: unknown) => Domain | undefined,
): Domain | undefined {
  const range = useContext(PlaybackRangeContext);
  const sequenceValue = range?.sequenceValue;

  const computedDomain = useMemo(
    () =>
      sequenceValue === undefined
        ? undefined
        : getSequenceDomain(sequenceValue),
    [sequenceValue, kind], // eslint-disable-line react-hooks/exhaustive-deps -- `kind` identifies `getSequenceDomain`
  );

  // Sequence's values are dropped once its range is known, so remember it (outside of render);
  // if another kind of range is needed afterwards (e.g. scale type changed), get values again
  useEffect(() => {
    if (!range) {
      return;
    }
    if (sequenceValue !== undefined) {
      range.computedKinds.add(kind);
      if (computedDomain) {
        range.sequenceDomains.set(kind, computedDomain);
      }
    } else if (!range.computedKinds.has(kind)) {
      range.requestSequence?.();
    }
  }, [range, kind, sequenceValue, computedDomain]);

  const sequenceDomain = computedDomain ?? range?.sequenceDomains.get(kind);

  const seenDomain = extendDomain(range?.seenDomains.get(kind), frameDomain);

  // Remember range of slices shown so far (outside of render)
  useEffect(() => {
    if (range && seenDomain) {
      range.seenDomains.set(kind, seenDomain);
    }
  }, [range, kind, seenDomain]);

  if (!range) {
    return frameDomain;
  }

  // Include range of slices shown so far, in case the sequence's values don't cover all that is
  // plotted (e.g. errors, auxiliary signals)
  return extendDomain(sequenceDomain, seenDomain);
}
