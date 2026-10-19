import { MdGesture } from 'react-icons/md';

import { type VisDef } from '../models';
import NurbsVisContainer from './NurbsVisContainer';

/* Group with `H5WEB_geometry = "nurbs"`: its control points, weights and knots */
export const NURBS_VIS: VisDef = {
  name: 'NURBS',
  Icon: MdGesture,
  Container: NurbsVisContainer,
};
