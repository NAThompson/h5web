import {
  hasArrayShape,
  hasComplexType,
  hasCompoundType,
  hasMinDims,
  hasNonNullShape,
  hasNumericLikeType,
  hasNumericType,
  hasPrintableCompoundType,
  hasPrintableType,
  isDataset,
} from '@h5web/shared/guards';
import { type Dataset } from '@h5web/shared/hdf5-models';
import {
  FiActivity,
  FiBox,
  FiCode,
  FiGrid,
  FiImage,
  FiMap,
} from 'react-icons/fi';
import {
  MdBubbleChart,
  MdGesture,
  MdLandscape,
  MdScatterPlot,
  MdViewModule,
  MdViewQuilt,
} from 'react-icons/md';

import { type DataContextValue } from '../../providers/DataProvider';
import { findScalarStrAttr, getAttributeValue } from '../../utils';
import { type VisDef } from '../models';
import MultiplesVisContainer from '../panels/MultiplesVisContainer';
import { getHintSafely } from '../view-hints/utils';
import ComplexCurveVisContainer from './complex/ComplexCurveVisContainer';
import { ComplexCurveConfigProvider } from './complex/curve-config';
import {
  HeatmapConfigProvider,
  LineConfigProvider,
  MatrixConfigProvider,
  RgbConfigProvider,
  ScalarConfigProvider,
} from './configs';
import {
  ComplexHeatmapVisContainer,
  ComplexLineVisContainer,
  CompoundVisContainer,
  HeatmapVisContainer,
  LineVisContainer,
  MatrixVisContainer,
  RgbVisContainer,
  ScalarVisContainer,
} from './containers';
import { CurveConfigProvider } from './geometry/config';
import CurveVisContainer from './geometry/CurveVisContainer';
import { getGeometryKind } from './geometry/hooks';
import ParamSurfaceVisContainer from './geometry/ParamSurfaceVisContainer';
import { ParamSurfaceConfigProvider } from './geometry/surface-config';
import { GeometryKind } from './geometry/utils';
import { OrthoslicesConfigProvider } from './orthoslices/config';
import OrthoslicesVisContainer from './orthoslices/OrthoslicesVisContainer';
import { ScatterConfigProvider } from './scatter/config';
import { getScatterSource } from './scatter/hooks';
import Scatter3DVisContainer from './scatter/Scatter3DVisContainer';
import ScatterVisContainer from './scatter/ScatterVisContainer';
import { VolumeConfigProvider } from './volume/config';
import VolumeVisContainer from './volume/VolumeVisContainer';

export enum Vis {
  Scalar = 'Scalar',
  Matrix = 'Matrix',
  Line = 'Line',
  Heatmap = 'Heatmap',
  ComplexHeatmap = 'ComplexHeatmap',
  ComplexLine = 'Complex Line',
  ComplexCurve = 'Complex Curve',
  RGB = 'RGB',
  Compound = 'Compound',
  Volume = 'Volume',
  Orthoslices = 'Orthoslices',
  Curve = 'Curve',
  Surface = 'Surface',
  Multiples = 'Multiples',
  Scatter = 'Scatter',
  Scatter3D = 'Scatter 3D',
}

export interface CoreVisDef extends VisDef {
  supportsDataset: (
    dataset: Dataset,
    dataContext: DataContextValue,
  ) => Promise<boolean>;
}

/* Numeric datasets whose last three dimensions form a volume (leading ones are sliced) */
async function supportsVolume(
  dataset: Dataset,
  dataContext: DataContextValue,
): Promise<boolean> {
  if (
    !hasArrayShape(dataset) ||
    !hasMinDims(dataset, 3) ||
    !hasNumericType(dataset)
  ) {
    return false;
  }

  // Last three dimensions form the volume (leading ones are sliced): skip empty datasets
  // (nothing to slice either) and stacks of a single 2D image
  const { dims } = dataset.shape;
  if (dims.includes(0) || dims.slice(-3).some((dim) => dim < 2)) {
    return false;
  }

  // Leave images to the RGB vis
  const h5ClassAttr = findScalarStrAttr(dataset, 'CLASS');
  const h5Class = await getAttributeValue(dataset, h5ClassAttr, dataContext);
  return h5Class !== 'IMAGE';
}

export const CORE_VIS = {
  [Vis.Scalar]: {
    name: Vis.Scalar,
    Icon: FiCode,
    Container: ScalarVisContainer,
    ConfigProvider: ScalarConfigProvider,
    supportsDataset: async (dataset) => hasNonNullShape(dataset),
  },

  [Vis.Matrix]: {
    name: Vis.Matrix,
    Icon: FiGrid,
    Container: MatrixVisContainer,
    ConfigProvider: MatrixConfigProvider,
    supportsDataset: async (dataset) => {
      return hasArrayShape(dataset) && hasPrintableType(dataset);
    },
  },

  [Vis.Line]: {
    name: Vis.Line,
    Icon: FiActivity,
    Container: LineVisContainer,
    ConfigProvider: LineConfigProvider,
    supportsDataset: async (dataset) => {
      return hasArrayShape(dataset) && hasNumericLikeType(dataset);
    },
  },

  // Before complex line plot, which stays the default for complex datasets
  [Vis.ComplexCurve]: {
    name: Vis.ComplexCurve,
    Icon: MdGesture,
    Container: ComplexCurveVisContainer,
    ConfigProvider: ComplexCurveConfigProvider,
    // Only for R → C data: a slice of a C → C grid is not a meaningful curve
    supportsDataset: async (dataset) => {
      return (
        hasArrayShape(dataset) &&
        hasComplexType(dataset) &&
        dataset.shape.dims.length === 1
      );
    },
    // Picking the curve of a slice of a 2D+ dataset must not open other complex datasets as curves
    canBePreferredFor: (entity) =>
      isDataset(entity) &&
      hasArrayShape(entity) &&
      entity.shape.dims.length === 1,
  },

  [Vis.ComplexLine]: {
    name: Vis.ComplexLine,
    Icon: FiActivity,
    Container: ComplexLineVisContainer,
    ConfigProvider: LineConfigProvider,
    supportsDataset: async (dataset) => {
      return hasArrayShape(dataset) && hasComplexType(dataset);
    },
  },

  [Vis.Volume]: {
    name: Vis.Volume,
    Icon: FiBox,
    Container: VolumeVisContainer,
    ConfigProvider: VolumeConfigProvider,
    canBePreferredFor: () => false,
    supportsDataset: supportsVolume,
  },

  // Three linked planes through a volume (last three dimensions), on demand or when hinted
  [Vis.Orthoslices]: {
    name: Vis.Orthoslices,
    Icon: MdViewQuilt,
    Container: OrthoslicesVisContainer,
    ConfigProvider: OrthoslicesConfigProvider,
    canBePreferredFor: () => false, // fetches the whole volume
    supportsDataset: supportsVolume, // as volumes
  },

  [Vis.Heatmap]: {
    name: Vis.Heatmap,
    Icon: FiMap,
    Container: HeatmapVisContainer,
    ConfigProvider: HeatmapConfigProvider,
    supportsDataset: async (dataset) => {
      return (
        hasArrayShape(dataset) &&
        hasMinDims(dataset, 2) &&
        hasNumericLikeType(dataset)
      );
    },
  },

  // Small multiples of `H5WEB_multiples_dim`, the default vis then (cf. `findHintVis`)
  [Vis.Multiples]: {
    name: Vis.Multiples,
    Icon: MdViewModule,
    Container: MultiplesVisContainer,
    canBePreferredFor: () => false, // may fetch many slices
    supportsDataset: async (dataset, dataContext) => {
      if (
        !hasArrayShape(dataset) ||
        !hasMinDims(dataset, 2) ||
        !hasNumericLikeType(dataset) ||
        hasComplexType(dataset)
      ) {
        return false;
      }
      const hint = await getHintSafely(dataset, dataContext);
      return hint.multiplesDims !== undefined;
    },
  },

  [Vis.ComplexHeatmap]: {
    name: Vis.Heatmap,
    Icon: FiMap,
    Container: ComplexHeatmapVisContainer,
    ConfigProvider: HeatmapConfigProvider,
    supportsDataset: async (dataset) => {
      return (
        hasArrayShape(dataset) &&
        hasMinDims(dataset, 2) &&
        hasComplexType(dataset)
      );
    },
  },

  [Vis.RGB]: {
    name: Vis.RGB,
    Icon: FiImage,
    Container: RgbVisContainer,
    ConfigProvider: RgbConfigProvider,
    supportsDataset: async (dataset, dataContext) => {
      if (
        !hasArrayShape(dataset) ||
        !hasMinDims(dataset, 3) || // 2 for axes + 1 for RGB(A) channels
        !hasNumericType(dataset)
      ) {
        return false;
      }

      // Check number of channels: 3 for RGB/BGR, 4 for RGBA/BGRA
      const lastDim = dataset.shape.dims[dataset.shape.dims.length - 1];
      if (lastDim < 3 || lastDim > 4) {
        return false;
      }

      // Check for `CLASS=IMAGE` attribute
      const h5ClassAttr = findScalarStrAttr(dataset, 'CLASS');
      const h5Class = await getAttributeValue(
        dataset,
        h5ClassAttr,
        dataContext,
      );
      return h5Class === 'IMAGE';
    },
  },

  [Vis.Compound]: {
    name: Vis.Compound,
    Icon: FiGrid,
    Container: CompoundVisContainer,
    ConfigProvider: MatrixConfigProvider,
    supportsDataset: async (dataset) => {
      return (
        hasNonNullShape(dataset) &&
        hasCompoundType(dataset) &&
        hasPrintableCompoundType(dataset)
      );
    },
  },

  // Last, so they are selected by default when supported
  [Vis.Curve]: {
    name: Vis.Curve,
    Icon: MdGesture,
    Container: CurveVisContainer,
    ConfigProvider: CurveConfigProvider,
    supportsDataset: async (dataset, dataContext) => {
      return (
        (await getGeometryKind(dataset, dataContext)) === GeometryKind.Curve
      );
    },
  },

  [Vis.Surface]: {
    name: Vis.Surface,
    Icon: MdLandscape,
    Container: ParamSurfaceVisContainer,
    ConfigProvider: ParamSurfaceConfigProvider,
    supportsDataset: async (dataset, dataContext) => {
      return (
        (await getGeometryKind(dataset, dataContext)) === GeometryKind.Surface
      );
    },
  },

  // Points, only when hinted (or CF `featureType = "point"`): then the default (cf. `findScatterVis`)
  [Vis.Scatter]: {
    name: Vis.Scatter,
    Icon: MdScatterPlot,
    Container: ScatterVisContainer,
    ConfigProvider: ScatterConfigProvider,
    supportsDataset: async (dataset, dataContext) =>
      !!(await getScatterSource(dataset, dataContext)),
  },

  [Vis.Scatter3D]: {
    name: Vis.Scatter3D,
    Icon: MdBubbleChart,
    Container: Scatter3DVisContainer,
    ConfigProvider: ScatterConfigProvider,
    supportsDataset: async (dataset, dataContext) => {
      const source = await getScatterSource(dataset, dataContext);
      return !!source?.channels.z;
    },
  },
} satisfies Record<Vis, CoreVisDef>;

/* Default vis of points without `H5WEB_vis` (CF `featureType = "point"`): in 3D if possible */
export function findScatterVis<T extends VisDef>(
  supportedVis: T[],
): T | undefined {
  const [scatter3D, scatter]: string[] = [Vis.Scatter3D, Vis.Scatter];
  return (
    supportedVis.find(({ name }) => name === scatter3D) ??
    supportedVis.find(({ name }) => name === scatter)
  );
}
