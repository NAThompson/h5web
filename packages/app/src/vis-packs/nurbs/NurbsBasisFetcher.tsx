import { type GroupWithChildren } from '@h5web/shared/hdf5-models';

import { useNurbsCurve } from './hooks';
import NurbsBasisPlot from './NurbsBasisPlot';

interface Props {
  group: GroupWithChildren;
  className: string;
  rational: boolean; // `R(i,p)` if weighted, else `N(i,p)`
  showSum: boolean;
  showGrid: boolean;
}

/* Basis functions of a NURBS curve */
function NurbsBasisFetcher(props: Props) {
  const { group, rational, ...plotProps } = props;
  const curve = useNurbsCurve(group);
  const isWeighted = curve.weights.some((w) => w !== 1);

  return (
    <NurbsBasisPlot
      title={group.name}
      vector={curve}
      weights={rational && isWeighted ? curve.weights : undefined}
      param="u"
      {...plotProps}
    />
  );
}

export default NurbsBasisFetcher;
