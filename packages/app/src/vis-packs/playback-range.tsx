import { type Domain } from '@h5web/shared/vis-models';
import { createContext, useContext, useEffect, useMemo } from 'react';

/* Value range to use while playing through a sequence of slices (cf. `PlaybackRange` setting):
 * the range of the whole sequence when its values are known, otherwise the range of the slices
 * shown so far. Provided by containers (from `useSlicingProps`), used by mapped visualizations
 * in place of the current slice's data domain. */
export interface PlaybackRangeValue {
  key: string; // identifies the sequence; ranges are reset when it changes
  sequenceValue: unknown; // values of all slices of the sequence, if known
  seenDomains: Map<string, Domain>; // range of slices shown so far, per kind of domain
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

  const sequenceDomain = useMemo(
    () =>
      sequenceValue === undefined
        ? undefined
        : getSequenceDomain(sequenceValue),
    [sequenceValue, kind], // eslint-disable-line react-hooks/exhaustive-deps -- `kind` identifies `getSequenceDomain`
  );

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

  // Include current slice's domain in case it isn't fully covered (e.g. errors, auxiliaries)
  return sequenceDomain
    ? extendDomain(sequenceDomain, frameDomain)
    : seenDomain;
}
