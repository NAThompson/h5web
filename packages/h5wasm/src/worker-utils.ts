import {
  assertDefined,
  assertNonNull,
  isBigIntTypedArray,
  isNumericType,
  isTypedArray,
} from '@h5web/shared/guards';
import { H5T_CLASS, H5T_ORDER } from '@h5web/shared/h5t';
import {
  type Attribute,
  type ChildEntity,
  type DType,
  EntityKind,
  type Group,
  type H5WebComplex,
  type ProvidedEntity,
  type VirtualSource,
} from '@h5web/shared/hdf5-models';
import {
  arrayType,
  bitfieldType,
  buildEntityPath,
  compoundOrCplxType,
  cplxType,
  enumOrBoolType,
  floatType,
  getNameFromPath,
  intType,
  opaqueType,
  parseShape,
  referenceType,
  strType,
  timeType,
  unknownType,
  vlenType,
} from '@h5web/shared/hdf5-utils';
import { type BigIntTypedArray, type NumArray } from '@h5web/shared/vis-models';
import { SCALAR_SELECTION_REGEXP } from '@h5web/shared/vis-utils';
import {
  type Dataset as H5WasmDataset,
  type Metadata,
  type ready as h5wasmReady,
} from 'h5wasm';
import { nanoid } from 'nanoid';

import { type LazyFile } from './lazy-file';

export const PLUGINS_FOLDER = 'plugins'; // path to plugins on EMScripten virtual file system
export const WORKERFS_FOLDER = 'workerfs';

export async function initH5Wasm(
  ready: typeof h5wasmReady,
): typeof h5wasmReady {
  const module = await ready;

  // Throw HDF5 errors instead of just logging them
  module.activate_throwing_error_handler();

  // Replace default plugins path
  module.remove_plugin_search_path(0);
  module.insert_plugin_search_path(`/${PLUGINS_FOLDER}`, 0);

  // Create plugins folder on Emscripten virtual file system
  module.FS.mkdirTree(PLUGINS_FOLDER);

  return module;
}

let workerFSRootNode: unknown;

export async function mountWorkerFS(
  h5wasm: Awaited<typeof h5wasmReady>,
): Promise<unknown> {
  if (workerFSRootNode !== undefined) {
    return workerFSRootNode;
  }

  const { FS } = h5wasm;
  const { WORKERFS } = FS.filesystems;

  FS.mkdir(WORKERFS_FOLDER);
  workerFSRootNode = FS.mount(
    WORKERFS as FS.FileSystemType,
    {},
    WORKERFS_FOLDER,
  );

  return workerFSRootNode;
}

let lastReadError: Error | undefined; // cause of last failed read of a lazy file, if any

/* Name failed reads so the app can tell them from HDF5 errors once they have
 * crossed the worker boundary (which preserves names but not classes), and
 * not mistake them for missing data (cf. `isTransportError` in `@h5web/app`). */
function toReadError(error: unknown): Error {
  const message = error instanceof Error ? error.message : 'Read failed';
  const readError = new Error(message, { cause: error });
  readError.name = 'ReadError';
  return readError;
}

/* Report the actual cause of failed reads of lazy files (e.g. network error,
 * file changed on server, etc.) instead of the generic HDF5 error. */
export function withReadErrors<T>(fn: () => T): T {
  lastReadError = undefined;

  try {
    return fn();
  } catch (error) {
    throwIfReadError();
    throw error;
  }
}

/* Within `withReadErrors`, rethrow the cause of a failed read of a lazy file,
 * if any, so callers that swallow HDF5-level errors don't swallow it too. */
export function throwIfReadError(): void {
  if (lastReadError !== undefined) {
    throw lastReadError;
  }
}

/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
export function createLazyFileNode(
  FS: FS.FileSystemType,
  rootNode: unknown,
  fileName: string,
  lazyFile: LazyFile,
): () => void {
  const { WORKERFS } = FS.filesystems;
  const { ErrnoError, destroyNode } = FS as unknown as {
    ErrnoError: new (errno: number) => Error;
    destroyNode: (node: unknown) => void;
  };

  // Create read-only file node with WORKERFS, then override its `read` operation
  const node = WORKERFS.createNode(
    rootNode,
    fileName,
    WORKERFS.FILE_MODE,
    0,
    lazyFile, // WORKERFS only uses `size` when creating the node
  );

  node.stream_ops = {
    ...WORKERFS.stream_ops,
    read(
      _: unknown,
      buffer: Int8Array,
      offset: number,
      length: number,
      position: number,
    ): number {
      try {
        const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset);
        return lazyFile.read(bytes, offset, length, position);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(error);
        lastReadError = toReadError(error);
        throw new ErrnoError(29); // EIO - lets HDF5 fail gracefully
      }
    },
  };

  // WORKERFS doesn't support unlinking files, so remove node manually
  return () => {
    destroyNode(node);
    delete node.parent.contents[fileName]; // eslint-disable-line @typescript-eslint/no-dynamic-delete
  };
}
/* eslint-enable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */

export function getAvailableFileName(
  FS: FS.FileSystemType,
  mountPt = '',
): string {
  const fileName = nanoid();
  const filePath = `${mountPt && `${mountPt}/`}${fileName}`;
  return FS.analyzePath(filePath).exists
    ? getAvailableFileName(FS, mountPt)
    : fileName;
}

export function parseEntity(
  h5wasm: Awaited<typeof h5wasmReady>,
  fileId: bigint,
  path: string,
  isChild: true,
): ChildEntity;

export function parseEntity(
  h5wasm: Awaited<typeof h5wasmReady>,
  fileId: bigint,
  path: string,
  isChild?: false,
): ProvidedEntity;

export function parseEntity(
  h5wasm: Awaited<typeof h5wasmReady>,
  fileId: bigint,
  path: string,
  isChild = false,
): ProvidedEntity | ChildEntity {
  const baseEntity = { name: getNameFromPath(path), path, attributes: [] };

  const kind = h5wasm.get_type(fileId, path);

  if (kind === h5wasm.H5G_GROUP) {
    const baseGroup: Group = {
      ...baseEntity,
      kind: EntityKind.Group,
      attributes: parseAttributes(h5wasm, fileId, path),
    };

    if (isChild) {
      return baseGroup;
    }

    const childrenNames = h5wasm.get_names(fileId, path, false);
    return {
      ...baseGroup,
      children: childrenNames.map((childName) =>
        parseEntity(h5wasm, fileId, buildEntityPath(path, childName), true),
      ),
    };
  }

  if (kind === h5wasm.H5G_DATASET) {
    const metadata = h5wasm.get_dataset_metadata(fileId, path);
    const { chunks, maxshape, shape, virtual_sources, ...rawType } = metadata; // keep `rawType` concise

    return {
      ...baseEntity,
      kind: EntityKind.Dataset,
      shape: parseShape(shape),
      type: parseDType(metadata),
      chunks: chunks ?? undefined,
      filters: h5wasm.get_dataset_filters(fileId, path),
      virtualSources: parseVirtualSources(metadata),
      attributes: parseAttributes(h5wasm, fileId, path),
      rawType,
    };
  }

  if (kind === h5wasm.H5G_TYPE) {
    const metadata = h5wasm.get_datatype_metadata(fileId, path);
    const { chunks, maxshape, shape, ...rawType } = metadata; // keep `rawType` concise

    return {
      ...baseEntity,
      kind: EntityKind.Datatype,
      type: parseDType(metadata),
      attributes: parseAttributes(h5wasm, fileId, path),
      rawType,
    };
  }

  if (kind === h5wasm.H5G_LINK) {
    const target = h5wasm.get_symbolic_link(fileId, path);
    return {
      ...baseEntity,
      kind: EntityKind.Unresolved,
      link: {
        class: 'Soft',
        path: target,
      },
    };
  }

  if (kind === h5wasm.H5G_UDLINK) {
    const extLink = h5wasm.get_external_link(fileId, path);
    return {
      ...baseEntity,
      kind: EntityKind.Unresolved,
      link: {
        class: 'External',
        file: extLink.filename,
        path: extLink.obj_path,
      },
    };
  }

  return {
    ...baseEntity,
    kind: EntityKind.Unresolved,
  };
}

function parseAttributes(
  h5wasm: Awaited<typeof h5wasmReady>,
  fileId: bigint,
  path: string,
): Attribute[] {
  const names = h5wasm.get_attribute_names(fileId, path);

  return names.map((name) => {
    const metadata = h5wasm.get_attribute_metadata(fileId, path, name);
    return {
      name,
      shape: parseShape(metadata.shape),
      type: parseDType(metadata),
    };
  });
}

/* eslint-disable @typescript-eslint/no-unsafe-enum-comparison */
export function parseDType(metadata: Metadata): DType {
  const { type: h5tClass, size } = metadata;

  if (h5tClass === H5T_CLASS.INTEGER) {
    const { signed, littleEndian } = metadata;
    return intType(
      signed,
      size * 8,
      littleEndian ? H5T_ORDER.LE : H5T_ORDER.BE,
    );
  }

  if (h5tClass === H5T_CLASS.FLOAT) {
    const { littleEndian } = metadata;
    return floatType(size * 8, littleEndian ? H5T_ORDER.LE : H5T_ORDER.BE);
  }

  if (h5tClass === H5T_CLASS.TIME) {
    return timeType();
  }

  if (h5tClass === H5T_CLASS.STRING) {
    const { cset, strpad, vlen } = metadata;
    return strType(cset, strpad, vlen ? undefined : size);
  }

  if (h5tClass === H5T_CLASS.BITFIELD) {
    return bitfieldType();
  }

  if (h5tClass === H5T_CLASS.OPAQUE) {
    return opaqueType();
  }

  if (h5tClass === H5T_CLASS.COMPOUND) {
    const { compound_type } = metadata;
    assertDefined(compound_type);

    return compoundOrCplxType(
      compound_type.members.map(({ name, ...mType }) => [
        name,
        parseDType(mType),
      ]),
    );
  }

  if (h5tClass === H5T_CLASS.REFERENCE) {
    return referenceType();
  }

  if (h5tClass === H5T_CLASS.ENUM) {
    const { enum_type } = metadata;
    assertDefined(enum_type);
    const { members, type } = enum_type;

    const baseType = parseDType({ ...metadata, type });
    if (!isNumericType(baseType)) {
      throw new TypeError('Expected enum type to have numeric base type');
    }

    return enumOrBoolType(baseType, members);
  }

  if (h5tClass === H5T_CLASS.VLEN) {
    const { vlen_type } = metadata;
    assertDefined(vlen_type);
    return vlenType(parseDType(vlen_type));
  }

  if (h5tClass === H5T_CLASS.ARRAY) {
    const { array_type } = metadata;
    assertDefined(array_type);
    assertNonNull(array_type.shape);
    return arrayType(parseDType(array_type), array_type.shape);
  }

  if (h5tClass === H5T_CLASS.COMPLEX) {
    const { littleEndian } = metadata;

    /* Both components of an `H5T_COMPLEX` are the same float type, so each one
     * is exactly half the itemsize and needs no metadata of its own. */
    return cplxType(
      floatType((size / 2) * 8, littleEndian ? H5T_ORDER.LE : H5T_ORDER.BE),
    );
  }

  return unknownType();
}
/* eslint-enable @typescript-eslint/no-unsafe-enum-comparison */

function parseVirtualSources(metadata: Metadata): VirtualSource[] | undefined {
  return metadata.virtual_sources?.map(({ file_name, dset_name }) => ({
    file: file_name,
    path: dset_name,
  }));
}

/* h5wasm hands back a typed array for a dataset value but a plain array for an
 * attribute's `json_value`, so both layouts have to be recognised. Only the
 * plain array pays for the element check; a typed array is numeric by type. */
function isComponentArray(value: unknown): value is NumArray {
  return (
    isTypedArray(value) ||
    (Array.isArray(value) && value.every((val) => typeof val === 'number'))
  );
}

/* h5wasm exposes an `H5T_COMPLEX` value as a flat typed array of interleaved
 * components, which keeps them at storage precision and avoids allocating one
 * object per element. H5Web's value model is one `[real, imag]` pair per
 * element, so the components are paired up here. Exported for testing. */
export function pairComplexComponents(
  components: NumArray,
): H5WebComplex[] | undefined {
  if (components.length % 2 !== 0) {
    return undefined; // not an interleaved component array after all
  }

  const pairs: H5WebComplex[] = [];
  for (let i = 0; i < components.length; i += 2) {
    pairs.push([components[i], components[i + 1]]);
  }

  return pairs;
}

/* `isScalar` covers both a scalar dataset and a scalar selection of an array
 * one: H5Web expects a bare `[real, imag]` pair rather than an array of one. */
export function parseComplexValue(value: unknown, isScalar: boolean): unknown {
  if (!isComponentArray(value)) {
    return value; // unexpected layout - leave it to the caller's type guards
  }

  const pairs = pairComplexComponents(value);
  if (!pairs) {
    return value;
  }

  return isScalar ? pairs[0] : pairs;
}

type TypedArray = Exclude<NumArray, number[]> | BigIntTypedArray;

export const SLAB_SIZE = 32 * 1024 * 1024; // in bytes

/* Read large numeric selections slab by slab (along their first dimension) into a single
 * typed array, so the WebAssembly heap doesn't need to grow to the size of the entire
 * selection (it never shrinks back) and only a small buffer is copied out of it at a time. */
export function readInSlabs(
  h5wDataset: H5WasmDataset,
  ranges: [number, number][],
  slabSize = SLAB_SIZE,
): TypedArray | undefined {
  const { type, size } = h5wDataset.metadata;
  /* eslint-disable @typescript-eslint/no-unsafe-enum-comparison -- h5wasm types the class as a plain number */
  if (type !== H5T_CLASS.INTEGER && type !== H5T_CLASS.FLOAT) {
    return undefined;
  }
  /* eslint-enable @typescript-eslint/no-unsafe-enum-comparison */

  const [[start, stop], ...otherRanges] = ranges;
  const count = stop - start;
  const slabItems = otherRanges.reduce((acc, [a, b]) => acc * (b - a), 1);
  const slabBytes = slabItems * size;
  const slabCount = Math.max(1, Math.floor(slabSize / slabBytes)); // indices along first dimension per slab

  if (count <= slabCount || slabItems === 0) {
    return undefined; // selection fits in a single slab
  }

  let output: TypedArray | undefined;
  for (let i = start; i < stop; i += slabCount) {
    const slab = h5wDataset.slice([
      [i, Math.min(i + slabCount, stop)],
      ...otherRanges,
    ]);

    if (!isTypedArray(slab) && !isBigIntTypedArray(slab)) {
      return undefined; // let caller read selection in one go (only happens on first slab)
    }

    if (!output) {
      const Constructor = slab.constructor as new (
        length: number,
      ) => TypedArray;
      output = new Constructor(count * slabItems);
    }

    // `set` is typed per array type, but `output` is always of the same type as `slab`
    (output as Float64Array).set(slab as Float64Array, (i - start) * slabItems);
  }

  return output;
}

/* Range `[start, stop)` along each dimension of a selection (e.g. `0,:,:`), or of the
 * whole dataset if there is no selection */
export function getSelectionRanges(
  shape: number[],
  selection: string | undefined,
): [number, number][] {
  if (!selection) {
    return shape.map((dim) => [0, dim]);
  }

  return selection.split(',').map<[number, number]>((member, i) => {
    if (member === ':') {
      return [0, shape[i]];
    }

    return [Number(member), Number(member) + 1];
  });
}

export function readSelectedValue(
  h5wDataset: H5WasmDataset,
  selection: string | undefined,
): unknown {
  /* eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison --
   * h5wasm types the class as a plain number */
  const isComplex = h5wDataset.metadata.type === H5T_CLASS.COMPLEX;
  const { shape } = h5wDataset;

  if (!selection) {
    const value =
      (shape?.length &&
        readInSlabs(
          h5wDataset,
          shape.map((dim) => [0, dim]),
        )) ||
      h5wDataset.value;

    return isComplex ? parseComplexValue(value, shape?.length === 0) : value;
  }

  assertNonNull(shape);
  const ranges = getSelectionRanges(shape, selection);

  const slicedValue =
    readInSlabs(h5wDataset, ranges) ?? h5wDataset.slice(ranges);
  const isScalarSelection = SCALAR_SELECTION_REGEXP.test(selection);

  if (isComplex) {
    return parseComplexValue(slicedValue, isScalarSelection);
  }

  /* h5wasm unwraps scalar slices inconsistently - e.g. it does so for opaque
   * datasets but not for compound, vlen, etc. */
  if (isScalarSelection && Array.isArray(slicedValue)) {
    return slicedValue[0];
  }

  return slicedValue;
}
