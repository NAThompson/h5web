import { type DimensionMapping } from '@h5web/lib';
import {
  type ArrayShape,
  type Dataset,
  type NumericLikeType,
} from '@h5web/shared/hdf5-models';
import { type NumArray } from '@h5web/shared/vis-models';
import { type NdArray } from 'ndarray';
import { type ReactElement } from 'react';

import { type ViewHint } from '../view-hints/models';

/* `H5WEB_*` attributes of a group shown as panels side by side */
export interface PanelsHint {
  paths: string[]; // `H5WEB_panels`, relative to the group
  layout?: [number, number]; // `H5WEB_layout`: rows, cols
  linkAxes?: boolean; // `H5WEB_link_axes` (default: true)
  linkCursor?: boolean; // `H5WEB_link_cursor` (default: true)
  domain?: [number | null, number | null] | 'symmetric'; // `H5WEB_shared_domain` / `H5WEB_symmetric`
  center?: number; // `H5WEB_center`, of a symmetric domain
  notes: string[];
}

export type PanelKind = 'heatmap' | 'line';

export type PanelDataset = Dataset<ArrayShape, NumericLikeType>;

/* One panel: a dataset, or a slice of it (small multiples), as its hint says to show it */
export interface PanelSpec {
  key: string;
  dataset: PanelDataset;
  hint: ViewHint;
  kind: PanelKind;
  mapping: DimensionMapping; // of the dataset's dimensions
  title: string; // `_{…}` and `^{…}` markup
  row: number; // position in the grid (from 0)
  col: number;
  linkKey: string; // panels with the same key have the same axes
}

/* Values of a panel, as drawn */
export interface PanelLayerData {
  dataArray: NdArray<NumArray>; // heatmaps: rows along y
  abscissas: NumArray | undefined;
  ordinates?: NumArray | undefined;
}

/* How a vis is drawn as one of several panels */
export interface PanelVisOptions {
  showColorBar?: boolean; // e.g. not when panels share one
  renderLayer?: (data: PanelLayerData) => ReactElement; // drawn over the data (e.g. linked cursor)
}
