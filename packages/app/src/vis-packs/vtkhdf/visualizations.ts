import { FiBox } from 'react-icons/fi';
import { MdViewQuilt } from 'react-icons/md';

import { OrthoslicesConfigProvider } from '../core/orthoslices/config';
import { VolumeConfigProvider } from '../core/volume/config';
import { type VisDef } from '../models';
import VtkOrthoslicesContainer from './VtkOrthoslicesContainer';
import VtkVolumeContainer from './VtkVolumeContainer';

/* Fields of VTKHDF `UnstructuredGrid` groups, resampled onto a regular grid */
const VTK_VOLUME_VIS: VisDef = {
  name: 'Volume',
  Icon: FiBox,
  Container: VtkVolumeContainer,
  ConfigProvider: VolumeConfigProvider,
  canBePreferredFor: () => false, // fetches and resamples the whole mesh
};

const VTK_ORTHOSLICES_VIS: VisDef = {
  name: 'Orthoslices',
  Icon: MdViewQuilt,
  Container: VtkOrthoslicesContainer,
  ConfigProvider: OrthoslicesConfigProvider,
  canBePreferredFor: () => false,
};

export const VTK_GRID_VIS = [VTK_VOLUME_VIS, VTK_ORTHOSLICES_VIS];
