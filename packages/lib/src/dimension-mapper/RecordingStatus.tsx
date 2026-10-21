import { FiX } from 'react-icons/fi';

import Btn from '../toolbar/controls/Btn';
import { type RecordingStatus as Status } from './hooks';
import styles from './PlaybackControls.module.css';

interface Props {
  status: Status | undefined;
  onCancel: () => void; // or dismiss error
}

// Below playback controls, outside of their row
function RecordingStatus(props: Props) {
  const { status, onCancel } = props;
  if (!status) {
    return null;
  }

  const isError = 'error' in status;
  return (
    <span className={styles.recording} role={isError ? 'alert' : 'status'}>
      {isError ? status.error : `Recording ${status.current}/${status.total}…`}
      <Btn
        label={isError ? 'Dismiss' : 'Cancel recording'}
        Icon={FiX}
        iconOnly
        small
        onClick={onCancel}
      />
    </span>
  );
}

export default RecordingStatus;
