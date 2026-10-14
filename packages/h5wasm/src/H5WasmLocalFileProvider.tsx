import { DataProvider, type DataProviderApi } from '@h5web/app';
import { type PropsWithChildren } from 'react';

import { useH5WasmApi } from './hooks';
import { type Plugin } from './models';

interface Props {
  file: File;
  resetKeys?: unknown[];
  getExportURL?: DataProviderApi['getExportURL'];
  getPlugin?: (name: Plugin) => Promise<ArrayBuffer | undefined>;
  wasm64?: boolean; // use 64-bit build of h5wasm (Memory64), e.g. to read slices larger than 2 GB
}

function H5WasmLocalFileProvider(props: PropsWithChildren<Props>) {
  const {
    file,
    resetKeys = [],
    getExportURL,
    getPlugin,
    wasm64,
    children,
  } = props;

  const api = useH5WasmApi(
    file.name,
    async (remote) => remote.openLocalFile(file),
    [file, ...resetKeys],
    getExportURL,
    getPlugin,
    wasm64,
  );

  return <DataProvider api={api}>{children}</DataProvider>;
}

export default H5WasmLocalFileProvider;
