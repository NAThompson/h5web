import { type AxisTicks } from '@h5web/lib';
import {
  assertValue,
  hasArrayShape,
  hasNumericType,
  hasStringType,
  isAxisScaleType,
  isDataset,
} from '@h5web/shared/guards';
import {
  type ArrayShape,
  type ArrayValue,
  type Dataset,
  type Entity,
  type NumericType,
} from '@h5web/shared/hdf5-models';
import { type AxisMapping } from '@h5web/shared/nexus-models';
import { type AxisScaleType } from '@h5web/shared/vis-models';

import { type DataContextValue } from '../../providers/DataProvider';
import { isTransportError } from '../../providers/utils';
import {
  findAttribute,
  findScalarStrAttr,
  getAttributeValue,
} from '../../utils';
import { formatUnits } from '../units';
import { createAttrReader, toUnicodeScripts } from '../view-hints/attrs';
import { getDatasetLabels, getScaleLabels } from './slice-labels';

const RADIANS = /^\s*rad(?:ian)?s?\s*$/iu;

/* Label of a dimension with the `units` of its scale, except radians on ticks at multiples of π */
function withUnit(base: string, unit?: string, ticks?: AxisTicks): string {
  const shown =
    unit && !(ticks === 'pi' && RADIANS.test(unit)) && formatUnits(unit);
  return shown ? `${base} (${shown})` : base;
}

export interface DimScale {
  label?: string;
  name?: string; // short name of the dimension, e.g. for sliders: its label, else its scale's name
  value?: ArrayValue<NumericType>; // undefined if the dimension is labelled but has no usable scale
  unit?: string; // scale's `units` attribute, to guess whether to keep the ratio
  longName?: string; // scale's CF `long_name`, raw (`label` starts with it)
  ticks?: AxisTicks; // scale's `H5WEB_ticks` attribute
  scaleType?: AxisScaleType; // scale's `H5WEB_axis_scale`
  symlogConstant?: number; // scale's `H5WEB_symlog_threshold`
  notes?: string[]; // invalid `H5WEB_*` attributes of the scale
  sliceLabels?: string[]; // labels of the indices (`H5WEB_slice_labels`, string-valued scale)
}

interface UsableScale {
  dataset: Dataset<ArrayShape, NumericType>;
  value: ArrayValue<NumericType>;
}

/* Short labels of dimensions, `undefined` (i.e. `D<i>`) for those whose label isn't unique */
export function getUniqueLabels(
  labels: AxisMapping<string>,
): AxisMapping<string> {
  return labels.map((label) =>
    label && labels.indexOf(label) === labels.lastIndexOf(label)
      ? label
      : undefined,
  );
}

export async function getDimScales(
  dataset: Dataset<ArrayShape>,
  dataContext: DataContextValue,
): Promise<AxisMapping<DimScale>> {
  const { dims } = dataset.shape;

  const { queryClient, queries } = dataContext;
  const [labels, scales] = await Promise.all([
    getDimLabels(dataset, dataContext),
    queryClient.query(queries.dimensionScales(dataset)), // shared with curve detection
  ]);

  const dimScales = await Promise.all(
    dims.map(async (dimSize, index): Promise<DimScale | undefined> => {
      const label = labels[index];
      const scalePaths = scales?.[index] || []; // providers that can't dereference `DIMENSION_LIST` plot against indices
      const scale = await findUsableScale(scalePaths, dimSize, dataContext);
      const slice = await withoutDataErrors(
        getScaleLabels(scalePaths, scale?.dataset, dimSize, dataContext),
      );
      const sliceNotes = slice?.note ? [slice.note] : [];

      if (!scale) {
        // A label (or a string-valued scale) names the dimension even when no scale is attached
        const name = label || slice?.name;
        return name || sliceNotes.length > 0
          ? { label: name, name, sliceLabels: slice?.labels, notes: sliceNotes }
          : undefined;
      }

      const { dataset: scaleDataset, value } = scale;
      const { name, longName, unit, ticks, notes, ...hints } =
        await getScaleMeta(scaleDataset, dataContext);

      // CF `long_name` of the scale, else the dimension label, else the scale's own name
      const base =
        toUnicodeScripts(longName) || label || name || scaleDataset.name;

      return {
        label: withUnit(base, unit, ticks),
        name: label || name || scaleDataset.name,
        value,
        unit,
        longName,
        ticks,
        ...hints,
        sliceLabels: slice?.labels,
        notes: [...(notes ?? []), ...sliceNotes],
      };
    }),
  );

  // `H5WEB_slice_labels` of the dataset itself, over its scales' (notes on the first dimension)
  const own = await withoutDataErrors(
    getDatasetLabels(dataset, scales, dataContext),
  );
  if (own?.dim !== undefined) {
    dimScales[own.dim] = { ...dimScales[own.dim], sliceLabels: own.labels };
  }
  if (own?.note) {
    const [first] = dimScales;
    dimScales[0] = { ...first, notes: [...(first?.notes ?? []), own.note] };
  }
  return dimScales;
}

/* Errors that are not HDF5's own (e.g. network errors) are rethrown */
async function withoutDataErrors<T>(
  promise: Promise<T>,
): Promise<T | undefined> {
  try {
    return await promise;
  } catch (error) {
    if (isTransportError(error)) {
      throw error;
    }
    return undefined;
  }
}

/* `NAME` is the name given to `make_scale`, empty if none was. The attributes
 * are optional, so failing to read them must not hide an otherwise usable scale. */
async function getScaleMeta(
  scaleDataset: Dataset<ArrayShape, NumericType>,
  dataContext: DataContextValue,
): Promise<
  {
    name?: string;
    longName?: string;
    unit?: string;
    ticks?: AxisTicks;
  } & AxisHints
> {
  try {
    const [name, longName, unit, ticks, hints] = await Promise.all([
      getAttributeValue(
        scaleDataset,
        findScalarStrAttr(scaleDataset, 'NAME'),
        dataContext,
      ),
      getAttributeValue(
        scaleDataset,
        findScalarStrAttr(scaleDataset, 'long_name'),
        dataContext,
      ),
      getAttributeValue(
        scaleDataset,
        findScalarStrAttr(scaleDataset, 'units'),
        dataContext,
      ),
      getTicksHint(scaleDataset, dataContext),
      getAxisHints(scaleDataset, dataContext),
    ]);
    return {
      name,
      longName: longName || undefined,
      unit: unit || undefined,
      ticks,
      ...hints,
    };
  } catch {
    return {};
  }
}

/* `H5WEB_ticks` of a scale; failing to read it must not hide the scale's label */
async function getTicksHint(
  scaleDataset: Dataset<ArrayShape, NumericType>,
  dataContext: DataContextValue,
): Promise<AxisTicks | undefined> {
  try {
    const ticks = await getAttributeValue(
      scaleDataset,
      findScalarStrAttr(scaleDataset, 'H5WEB_ticks'),
      dataContext,
    );
    return ticks?.trim().toLowerCase() === 'pi' ? 'pi' : undefined;
  } catch {
    return undefined;
  }
}

type AxisHints = Pick<DimScale, 'scaleType' | 'symlogConstant' | 'notes'>;

const AXIS_HINT_ATTRS = ['H5WEB_axis_scale', 'H5WEB_symlog_threshold'];

/* `H5WEB_axis_scale` and `H5WEB_symlog_threshold` of a scale (invalid ones with a note); failing
 * to read them must not hide the scale */
async function getAxisHints(
  scaleDataset: Dataset<ArrayShape, NumericType>,
  dataContext: DataContextValue,
): Promise<AxisHints> {
  if (!AXIS_HINT_ATTRS.some((name) => findAttribute(scaleDataset, name))) {
    return {};
  }
  try {
    const { queryClient, queries } = dataContext;
    const values = await queryClient.query(queries.attrValues(scaleDataset));
    const notes: string[] = [];
    const read = createAttrReader(
      scaleDataset,
      values,
      notes,
      `${scaleDataset.name}: `,
    );
    const scaleType = read.oneOf('H5WEB_axis_scale', (val) => {
      const type = val.toLowerCase();
      return isAxisScaleType(type) ? type : undefined;
    });
    const symlogConstant = read.num(
      'H5WEB_symlog_threshold',
      (v) => Number.isFinite(v) && v > 0,
    );
    return { scaleType, symlogConstant, notes };
  } catch {
    return {};
  }
}

/* `NAME` of the scales netCDF-4 creates for dimensions without coordinate variable: not axes */
const PHONY_SCALE_NAME = 'This is a netCDF dimension but not a netCDF variable';

export function isPhonyScaleName(name: string | undefined): boolean {
  return !!name?.startsWith(PHONY_SCALE_NAME);
}

async function isPhonyScale(
  scaleDataset: Dataset<ArrayShape, NumericType>,
  dataContext: DataContextValue,
): Promise<boolean> {
  const { name } = await getScaleMeta(scaleDataset, dataContext);
  return isPhonyScaleName(name);
}

export function isUsableScale(
  entity: Entity | undefined,
  dimSize: number,
): entity is Dataset<ArrayShape, NumericType> {
  return (
    !!entity &&
    isDataset(entity) &&
    hasArrayShape(entity) &&
    hasNumericType(entity) &&
    entity.shape.dims.length === 1 &&
    entity.shape.dims[0] === dimSize
  );
}

/* HDF5 allows several scales per dimension, but H5Web can plot only one, so the
 * first usable scale wins: a dimension carrying N+1 bin boundaries next to N
 * bin centres still gets an axis. The spec allows a scale of "any rank and
 * shape" and leaves it "up to the application to interpret or resolve the
 * difference", so an unusable scale falls back to the index axis rather than
 * erroring. Errors that are not HDF5's own (e.g. network errors) are rethrown. */
async function findUsableScale(
  scalePaths: string[],
  dimSize: number,
  dataContext: DataContextValue,
): Promise<UsableScale | undefined> {
  const { queryClient, queries } = dataContext;

  /* eslint-disable no-await-in-loop -- stop at first usable scale found */
  for (const path of scalePaths) {
    try {
      const entity = await queryClient.query(queries.entity(path));

      if (
        isUsableScale(entity, dimSize) &&
        !(await isPhonyScale(entity, dataContext))
      ) {
        const value = await queryClient.query(queries.value(entity));
        assertValue(value, entity);
        return { dataset: entity, value };
      }
    } catch (error) {
      /* A network error, say, tells nothing about the scale: falling back to the
       * index axis would plot the data against the wrong axis, and cache it. */
      if (isTransportError(error)) {
        throw error;
      }

      // Unlinked or unreadable scale, say: try the next one, else fall back to the index axis
    }
  }
  /* eslint-enable no-await-in-loop */

  return undefined;
}

/* `DIMENSION_LABELS` is a plain attribute, so a dimension can be named even when
 * no scale is attached. HDF5 writes an empty string for unlabelled dimensions,
 * and may write fewer labels than the dataset has dimensions. */
async function getDimLabels(
  dataset: Dataset<ArrayShape>,
  dataContext: DataContextValue,
): Promise<AxisMapping<string>> {
  const attr = findAttribute(dataset, 'DIMENSION_LABELS');

  const labels =
    attr && hasArrayShape(attr) && hasStringType(attr)
      ? await getAttributeValue(dataset, attr, dataContext)
      : [];

  return dataset.shape.dims.map((_, index) => labels[index] || undefined);
}
