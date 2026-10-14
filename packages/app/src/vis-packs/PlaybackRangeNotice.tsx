import { useTimeoutEffect, useToggle } from '@react-hookz/web';
import { useStore } from 'zustand';

import { useDataContext } from '../providers/DataProvider';
import { type PlaybackRangeValue } from './playback-range';
import styles from './PlaybackRangeNotice.module.css';

// Wait a bit before showing notice, to avoid a flash when the range comes quickly
const SHOW_DELAY = 300; // ms

interface Props {
  loading: NonNullable<PlaybackRangeValue['loading']>;
}

/* Tell user the whole sequence's range is being fetched for playback, and let them cancel it
 * (playback then uses the range of slices shown so far) */
function PlaybackRangeNotice(props: Props) {
  const { loading } = props;
  const { progressStore } = useDataContext();
  const progress = useStore(progressStore, (state) =>
    state.ongoing.get(loading.queryHash),
  );

  const [isVisible, toggleVisible] = useToggle();
  useTimeoutEffect(toggleVisible, SHOW_DELAY);

  if (!isVisible) {
    return null;
  }

  return (
    <div className={styles.notice} role="status">
      Getting range of sequence…
      <progress
        className={styles.progress}
        value={progress}
        aria-label="Range of sequence"
      />
      <button
        className={styles.cancelBtn}
        type="button"
        onClick={() => loading.cancel()}
      >
        Cancel
      </button>
    </div>
  );
}

export default PlaybackRangeNotice;
