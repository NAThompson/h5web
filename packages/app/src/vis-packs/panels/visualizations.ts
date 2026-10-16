import { MdViewQuilt } from 'react-icons/md';

import { type VisDef } from '../models';
import PanelsVisContainer from './PanelsVisContainer';

/* Datasets of a group's `H5WEB_panels` side by side */
export const PANELS_VIS: VisDef = {
  name: 'Panels',
  Icon: MdViewQuilt,
  Container: PanelsVisContainer,
  canBePreferredFor: () => false,
};
