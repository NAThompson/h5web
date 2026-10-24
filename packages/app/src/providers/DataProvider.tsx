import { isGroup } from '@h5web/shared/guards';
import {
  type ArrayShape,
  type Dataset,
  type Entity,
  type ScalarShape,
} from '@h5web/shared/hdf5-models';
import { getNameFromPath } from '@h5web/shared/hdf5-utils';
import {
  hashKey,
  QueryClient,
  QueryClientProvider,
  queryOptions,
} from '@tanstack/react-query';
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { type DataProviderApi } from './api';
import {
  createProgressStore,
  type ProgressStore,
  trackProgress,
} from './progress-store';

function getQueryOptionsFactories(
  api: DataProviderApi,
  scope: string,
  queryClient: QueryClient,
  progressStore: ProgressStore,
) {
  return {
    entity: (path: string) => {
      return queryOptions({
        queryKey: [scope, 'entity', path] as const,
        queryFn: async () => {
          const queryKey = [scope, 'entity', path];
          const query = queryClient.getQueryCache().find({ queryKey });
          const entity = await api.getEntity(path);

          // Unless cache was cleared meanwhile (new API), so old children don't come back
          if (
            isGroup(entity) &&
            queryClient.getQueryCache().find({ queryKey }) === query
          ) {
            // Cache non-group children (datasets, datatypes and links)
            entity.children
              .filter((c) => !isGroup(c))
              .forEach((c) => {
                queryClient.setQueryData([scope, 'entity', c.path], c);
              });
          }

          return entity;
        },
      });
    },
    value: (dataset: Dataset<ScalarShape | ArrayShape>, selection?: string) => {
      const queryKey = [scope, 'value', dataset.path, selection] as const;
      const queryHash = hashKey(queryKey);

      return queryOptions({
        queryKey,
        queryFn: async ({ signal }) => {
          return trackProgress(progressStore, queryHash, async (onProgress) => {
            return api.getValue(dataset, selection, signal, onProgress);
          });
        },
      });
    },
    attrValues: (entity: Entity) => {
      return queryOptions({
        queryKey: [scope, 'attrValues', entity.path] as const,
        queryFn: async () => api.getAttrValues(entity),
      });
    },
    /* Paths of the HDF5 dimension scales attached to each dimension of a dataset (cf.
     * `DIMENSION_LIST`), or `null` if the provider cannot dereference `DIMENSION_LIST`.
     * Errors are not cached as data: a failed query is fetched again. */
    dimensionScales: (dataset: Dataset<ArrayShape>) => {
      return queryOptions({
        queryKey: [scope, 'dimensionScales', dataset.path] as const,
        queryFn: async (): Promise<string[][] | null> =>
          api.getDimensionScales ? api.getDimensionScales(dataset) : null,
      });
    },
  };
}

export interface DataContextValue {
  filepath: string;
  cacheScope: string; // first element of query keys (cf. `getCacheScope`)
  filename: string;
  queries: ReturnType<typeof getQueryOptionsFactories>;
  queryClient: QueryClient;
  progressStore: ProgressStore;
  // Undocumented
  getExportURL?: DataProviderApi['getExportURL'];
  getSearchablePaths?: DataProviderApi['getSearchablePaths'];
  getDimensionScales?: DataProviderApi['getDimensionScales'];
}

const DataContext = createContext({} as DataContextValue);

export function useDataContext() {
  return useContext(DataContext);
}

interface Props {
  api: DataProviderApi;
}

/* Query keys are scoped by API rather than by file path, as a new API may serve different content
 * for the same file (e.g. reopened after being rewritten, or reloaded while being appended to).
 * What's on screen keeps reading its own entries until content from the new API is ready. */
const apiIds = new WeakMap<DataProviderApi, number>();
let nextApiId = 0;

function getCacheScope(api: DataProviderApi): string {
  if (!apiIds.has(api)) {
    apiIds.set(api, nextApiId);
    nextApiId += 1;
  }
  return `${api.filepath}#${apiIds.get(api)}`;
}

function DataProvider(props: PropsWithChildren<Props>) {
  const { api, children } = props;

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            networkMode: 'always', // always fire queries regardless of online/offline status
            staleTime: 'static', // never ever refetch cached data
            gcTime: 15 * 60 * 1000, // keep cached data with no active queries for 15 min
            retry: false, // never retry fetching automatically on error
            structuralSharing: false, // not relevant since data is never refetched
          },
        },
      }),
  );

  // Drop entries of previous APIs once content from the new one is shown
  const cacheScope = getCacheScope(api);
  useEffect(() => {
    queryClient.removeQueries({
      predicate: (query) => query.queryKey[0] !== cacheScope,
    });
  }, [queryClient, cacheScope]);

  const [progressStore] = useState(createProgressStore);

  const value = useMemo(() => {
    const { filepath } = api;

    return {
      filepath,
      cacheScope,
      filename: getNameFromPath(filepath),
      queries: getQueryOptionsFactories(
        api,
        cacheScope,
        queryClient,
        progressStore,
      ),
      queryClient,
      progressStore,
      getExportURL: api.getExportURL?.bind(api),
      getSearchablePaths: api.getSearchablePaths?.bind(api),
      getDimensionScales: api.getDimensionScales?.bind(api),
    };
  }, [api, cacheScope, queryClient, progressStore]);

  return (
    <QueryClientProvider client={queryClient}>
      <DataContext value={value}>{children}</DataContext>
    </QueryClientProvider>
  );
}

export default DataProvider;
