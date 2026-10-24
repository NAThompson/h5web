import { DataProviderApi, type OnProgress } from '@h5web/app';
import {
  assertDataset,
  hasArrayShape,
  isDefined,
  isTypedArray,
} from '@h5web/shared/guards';
import {
  type ArrayShape,
  type AttributeValues,
  type Dataset,
  type Entity,
  type ProvidedEntity,
  type ScalarShape,
} from '@h5web/shared/hdf5-models';
import {
  type BuiltInExporter,
  type ExportFormat,
  type ExportURL,
} from '@h5web/shared/vis-models';
import { proxy, transfer } from 'comlink';

import { type Plugin } from './models';
import { getEnhancedError, PLUGINS_BY_FILTER_ID } from './utils';
import { type H5WasmWorkerAPI } from './worker-api';

let nextRequestId = 1;

export class H5WasmApi extends DataProviderApi {
  public constructor(
    private readonly remote: H5WasmWorkerAPI,
    fileName: string,
    private readonly fileId: Promise<bigint>,
    private readonly _getExportURL?: DataProviderApi['getExportURL'],
    private readonly getPlugin?: (
      name: Plugin,
    ) => Promise<ArrayBuffer | undefined>,
  ) {
    super(fileName);
  }

  public override async getEntity(path: string): Promise<ProvidedEntity> {
    try {
      return await this.remote.getEntity(await this.fileId, path);
    } catch (error) {
      throw getEnhancedError(error);
    }
  }

  public override async getValue(
    dataset: Dataset<ScalarShape | ArrayShape>,
    selection?: string,
    abortSignal?: AbortSignal,
    onProgress?: OnProgress,
  ): Promise<unknown> {
    const fileId = await this.fileId;

    await this.processFilters(dataset);

    // Large reads may be cancelled and report progress (see `direct-read.ts`)
    abortSignal?.throwIfAborted(); // e.g. while plugins were being loaded
    const requestId = nextRequestId;
    nextRequestId += 1;
    const cancel = () => {
      void this.remote.cancelValue(requestId);
    };
    abortSignal?.addEventListener('abort', cancel);

    try {
      const value = await this.remote.getValue(
        fileId,
        dataset.path,
        selection,
        requestId,
        onProgress && proxy(onProgress),
      );
      return selection ? value : truncateToShape(value, dataset);
    } catch (error) {
      throw getEnhancedError(error);
    } finally {
      abortSignal?.removeEventListener('abort', cancel);
    }
  }

  public override async getAttrValues(
    entity: Entity,
  ): Promise<AttributeValues> {
    const fileId = await this.fileId;

    return Object.fromEntries(
      await Promise.all(
        entity.attributes.map<Promise<[string, unknown]>>(async ({ name }) => [
          name,
          await this.remote.getAttrValue(fileId, entity.path, name),
        ]),
      ),
    );
  }

  public override getExportURL(
    format: ExportFormat,
    dataset: Dataset<ArrayShape>,
    selection?: string,
    builtInExporter?: BuiltInExporter,
  ): ExportURL | undefined {
    const url = this._getExportURL?.(
      format,
      dataset,
      selection,
      builtInExporter,
    );

    if (url) {
      return url;
    }

    if (!builtInExporter) {
      return undefined;
    }

    return async () => new Blob([builtInExporter()]);
  }

  public override async getSearchablePaths(root: string): Promise<string[]> {
    const fileId = await this.fileId;
    return this.remote.getDescendantPaths(fileId, root);
  }

  public override async getDimensionScales(
    dataset: Dataset<ArrayShape>,
  ): Promise<string[][]> {
    const fileId = await this.fileId;

    try {
      return await this.remote.getDimensionScales(fileId, dataset.path);
    } catch (error) {
      throw getEnhancedError(error);
    }
  }

  public async cleanUp(): Promise<number | undefined> {
    let fileId: bigint;
    try {
      fileId = await this.fileId;
    } catch {
      return undefined; // file could not be opened
    }

    return this.remote.closeFile(fileId);
  }

  private async processFilters(dataset: Dataset): Promise<void> {
    const fileId = await this.fileId;

    // Retrieve filters of any local virtual source datasets
    const localSources = await Promise.all(
      (dataset.virtualSources?.filter(({ file }) => file === '.') || []).map(
        async ({ path }) => this.remote.getEntity(fileId, path),
      ),
    );
    const allFilters = [dataset, ...localSources].flatMap((source) => {
      assertDataset(source);
      return source.filters || [];
    });

    // Load corresponding plugins
    await Promise.all(
      allFilters
        .map(({ id }) => PLUGINS_BY_FILTER_ID[id])
        .filter(isDefined)
        .map(this.loadPlugin.bind(this)),
    );
  }

  private async loadPlugin(plugin: Plugin): Promise<void> {
    if (await this.remote.isPluginLoaded(plugin)) {
      return; // plugin already loaded
    }

    const buffer = await this.getPlugin?.(plugin);
    if (!buffer) {
      // eslint-disable-next-line no-console
      console.warn(`Compression plugin ${plugin} not available`);
      return;
    }

    await this.remote.loadPlugin(plugin, transfer(buffer, [buffer]));
  }
}

/* An SWMR writer may have grown the dataset (along its first dimension) since its metadata was
 * read: keep the extent the viewer knows about, so datasets read at different times still match */
function truncateToShape(
  value: unknown,
  dataset: Dataset<ScalarShape | ArrayShape>,
): unknown {
  if (!hasArrayShape(dataset)) {
    return value;
  }

  const size = dataset.shape.dims.reduce((acc, dim) => acc * dim, 1);
  if (isTypedArray(value) && value.length > size) {
    return value.subarray(0, size);
  }
  return Array.isArray(value) && value.length > size
    ? value.slice(0, size)
    : value;
}
