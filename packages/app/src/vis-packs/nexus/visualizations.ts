import {
  hasComplexType,
  hasMinDims,
  hasNumDims,
  hasNumericType,
} from '@h5web/shared/guards';
import {
  type ArrayShape,
  type ComplexType,
  type Dataset,
  type GroupWithChildren,
  type NumericLikeType,
} from '@h5web/shared/hdf5-models';
import { NxInterpretation } from '@h5web/shared/nexus-models';
import { FiActivity, FiBox, FiFileText, FiImage, FiMap } from 'react-icons/fi';
import { MdGesture, MdGrain, MdLandscape } from 'react-icons/md';

import { type DataContextValue } from '../../providers/DataProvider';
import { findScalarStrAttr, getAttributeValue } from '../../utils';
import { ComplexCurveConfigProvider } from '../core/complex/curve-config';
import {
  HeatmapConfigProvider,
  LineConfigProvider,
  RgbConfigProvider,
} from '../core/configs';
import { CurveConfigProvider } from '../core/geometry/config';
import { getGeometryKind } from '../core/geometry/hooks';
import { ParamSurfaceConfigProvider } from '../core/geometry/surface-config';
import { GeometryKind } from '../core/geometry/utils';
import { ScatterConfigProvider } from '../core/scatter/config';
import { VolumeConfigProvider } from '../core/volume/config';
import { type VisDef } from '../models';
import {
  NxComplexCurveContainer,
  NxComplexLineContainer,
  NxCurveContainer,
  NxHeatmapContainer,
  NxLineContainer,
  NxRgbContainer,
  NxScatterContainer,
  NxSurfaceContainer,
  NxVolumeContainer,
} from './containers';
import NxNoteContainer from './containers/NxNoteContainer';
import { findAxesDatasets, isPrimaryVolume, supportsVolume } from './utils';

export const NX_NOTE_VIS = {
  name: 'NX Note',
  Icon: FiFileText,
  Container: NxNoteContainer,
} satisfies VisDef;

export enum NxDataVis {
  NxLine = 'NX Line',
  NxComplexLine = 'NX Complex Line',
  NxComplexCurve = 'NX Complex Curve',
  // Before heatmap, so heatmap remains the default (i.e. last) vis when no vis is primary, as in the core pack
  NxVolume = 'NX Volume',
  NxHeatmap = 'NX Heatmap',
  NxRGB = 'NX RGB',
  NxScatter = 'NX Scatter',
  NxCurve = 'NX Curve',
  NxSurface = 'NX Surface',
}

export interface NxDataVisDef extends VisDef {
  supports: (
    group: GroupWithChildren,
    signal: Dataset<ArrayShape, NumericLikeType | ComplexType>,
    interpretation: string | undefined,
    dataContext: DataContextValue,
  ) => Promise<boolean>;
  isPrimary: (
    interpretation: string | undefined,
    signal: Dataset<ArrayShape, NumericLikeType | ComplexType>,
    axisDatasets: (Dataset | undefined)[],
  ) => boolean;
}

export const NX_DATA_VIS = {
  [NxDataVis.NxLine]: {
    name: NxDataVis.NxLine,
    Icon: FiActivity,
    Container: NxLineContainer,
    ConfigProvider: LineConfigProvider,
    supports: async (_, signal) => !hasComplexType(signal),
    isPrimary: (interpretation) => interpretation === NxInterpretation.Spectrum,
  },

  // Before complex line plot, which stays the default for complex signals
  [NxDataVis.NxComplexCurve]: {
    name: NxDataVis.NxComplexCurve,
    Icon: MdGesture,
    Container: NxComplexCurveContainer,
    ConfigProvider: ComplexCurveConfigProvider,
    supports: async (_, signal) => hasComplexType(signal),
    isPrimary: () => false,
  },

  [NxDataVis.NxComplexLine]: {
    name: NxDataVis.NxComplexLine,
    Icon: FiActivity,
    Container: NxComplexLineContainer,
    ConfigProvider: LineConfigProvider,
    supports: async (_, signal) => hasComplexType(signal),
    isPrimary: (interpretation) => interpretation === NxInterpretation.Spectrum,
  },

  [NxDataVis.NxVolume]: {
    name: NxDataVis.NxVolume,
    Icon: FiBox,
    Container: NxVolumeContainer,
    ConfigProvider: VolumeConfigProvider,
    supports: async (_, signal, interpretation, dataContext) =>
      supportsVolume(signal, interpretation, dataContext),
    canBePreferredFor: () => false,
    isPrimary: isPrimaryVolume,
  },

  [NxDataVis.NxHeatmap]: {
    name: NxDataVis.NxHeatmap,
    Icon: FiMap,
    Container: NxHeatmapContainer,
    ConfigProvider: HeatmapConfigProvider,
    supports: async (_, signal) => hasMinDims(signal, 2),
    isPrimary: (interpretation) => interpretation === NxInterpretation.Image,
  },

  [NxDataVis.NxRGB]: {
    name: NxDataVis.NxRGB,
    Icon: FiImage,
    Container: NxRgbContainer,
    ConfigProvider: RgbConfigProvider,
    supports: async (_, signal, interpretation, dataContext) => {
      if (
        !hasMinDims(signal, 3) || // 2 for axes + 1 for RGB(A) channels
        !hasNumericType(signal)
      ) {
        return false;
      }

      // Check number of channels: 3 for RGB/BGR, 4 for RGBA/BGRA
      const lastDim = signal.shape.dims[signal.shape.dims.length - 1];
      if (lastDim < 3 || lastDim > 4) {
        return false;
      }

      // Check for `rgb(a)-image` interpretation or `CLASS=IMAGE` attribute
      const classAttr = findScalarStrAttr(signal, 'CLASS');
      return (
        interpretation === NxInterpretation.RGB ||
        interpretation === NxInterpretation.RGBA ||
        (await getAttributeValue(signal, classAttr, dataContext)) === 'IMAGE'
      );
    },
    isPrimary: () => true, // always primary if supported
  },

  [NxDataVis.NxScatter]: {
    name: NxDataVis.NxScatter,
    Icon: MdGrain,
    Container: NxScatterContainer,
    ConfigProvider: ScatterConfigProvider,
    supports: async (group, signal, _, dataContext) => {
      if (!hasNumDims(signal, 1)) {
        return false;
      }

      const axisDatasets = await findAxesDatasets(group, signal, dataContext);
      return (
        axisDatasets.length === 2 &&
        axisDatasets.every((d) => d && hasNumDims(d, 1))
      );
    },
    isPrimary: () => true, // always primary if supported
  },

  [NxDataVis.NxCurve]: {
    name: NxDataVis.NxCurve,
    Icon: MdGesture,
    Container: NxCurveContainer,
    ConfigProvider: CurveConfigProvider,
    supports: async (_, signal, __, dataContext) =>
      (await getGeometryKind(signal, dataContext)) === GeometryKind.Curve,
    isPrimary: () => true, // always primary if supported
  },

  [NxDataVis.NxSurface]: {
    name: NxDataVis.NxSurface,
    Icon: MdLandscape,
    Container: NxSurfaceContainer,
    ConfigProvider: ParamSurfaceConfigProvider,
    supports: async (_, signal, __, dataContext) =>
      (await getGeometryKind(signal, dataContext)) === GeometryKind.Surface,
    isPrimary: () => true, // always primary if supported
  },
} satisfies Record<NxDataVis, NxDataVisDef>;
