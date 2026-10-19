import { getKnotVectors } from '@h5web/lib';
import { type GroupWithChildren } from '@h5web/shared/hdf5-models';
import { useMemo } from 'react';

import { useNurbsSurfaces } from './hooks';
import NurbsBasisPlot from './NurbsBasisPlot';

interface Props {
  group: GroupWithChildren;
  className: string;
  param: 'u' | 'v';
  showSum: boolean;
  showGrid: boolean;
}

/* Basis functions of a NURBS surface along `u` or `v`: non-rational, as rational basis
 * functions of surfaces depend on both `u` and `v` */
function NurbsSurfaceBasisFetcher(props: Props) {
  const { group, param, ...plotProps } = props;
  const [surface] = useNurbsSurfaces(group);
  const vectors = useMemo(() => getKnotVectors(surface), [surface]);

  return (
    <NurbsBasisPlot
      title={group.name}
      vector={vectors[param === 'u' ? 0 : 1]}
      param={param}
      {...plotProps}
    />
  );
}

export default NurbsSurfaceBasisFetcher;
