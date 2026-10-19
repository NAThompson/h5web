import { MdOutlineNorthEast } from 'react-icons/md';

import { type VisDef } from '../models';
import VectorVisContainer from './VectorVisContainer';

/* Dataset (…, ny, nx, 2) or (…, nz, ny, nx, 3), or group naming its components, with
 * `H5WEB_vis = "vector"` */
export const VECTOR_VIS: VisDef = {
  name: 'Vector',
  Icon: MdOutlineNorthEast,
  Container: VectorVisContainer,
};
