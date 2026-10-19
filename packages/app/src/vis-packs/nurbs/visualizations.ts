import { MdGesture, MdStackedLineChart } from 'react-icons/md';

import { type VisDef } from '../models';
import NurbsBasisContainer from './NurbsBasisContainer';
import NurbsVisContainer from './NurbsVisContainer';

/* Group with `H5WEB_geometry = "nurbs"` or `"bspline"`: its control points, weights and knots */
export const NURBS_VIS: VisDef = {
  name: 'NURBS',
  Icon: MdGesture,
  Container: NurbsVisContainer,
};

/* Basis functions of the same groups, with their knots */
export const NURBS_BASIS_VIS: VisDef = {
  name: 'Basis',
  Icon: MdStackedLineChart,
  Container: NurbsBasisContainer,
};
