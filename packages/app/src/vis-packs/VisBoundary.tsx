import { type PropsWithChildren, Suspense } from 'react';
import { ErrorBoundary } from 'react-error-boundary';

import ErrorFallback from '../ErrorFallback';
import { useDataContext } from '../providers/DataProvider';
import visualizerStyles from '../visualizer/Visualizer.module.css';
import { isPlaybackQuery } from './prefetch';
import ValueLoader from './ValueLoader';

interface Props {
  resetKey?: unknown;
  isSlice?: boolean;
}

function VisBoundary(props: PropsWithChildren<Props>) {
  const { resetKey, isSlice, children } = props;
  const { queryClient } = useDataContext();

  return (
    <ErrorBoundary
      resetKeys={[resetKey]}
      fallbackRender={(args) => (
        <ErrorFallback className={visualizerStyles.vis} {...args} />
      )}
      onError={() => {
        queryClient.removeQueries({
          // Keep errors of slices prefetched for playback until playback stops (to avoid refetching them)
          predicate: (query) =>
            query.state.status === 'error' &&
            !isPlaybackQuery(queryClient, query),
        });
      }}
    >
      <Suspense fallback={<ValueLoader isSlice={isSlice} />}>
        {children}
      </Suspense>
    </ErrorBoundary>
  );
}

export default VisBoundary;
