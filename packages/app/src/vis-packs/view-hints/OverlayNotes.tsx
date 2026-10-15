import styles from './ViewHints.module.css';

interface Props {
  notes: string[];
}

/* What parts of a `H5WEB_view` hint can't be applied (e.g. overlays that failed to resolve) */
function OverlayNotes(props: Props) {
  const { notes } = props;
  if (notes.length === 0) {
    return null;
  }

  return (
    <div className={styles.notes} role="note" aria-label="View hint notes">
      {notes.map((note) => (
        <p key={note}>{note}</p>
      ))}
    </div>
  );
}

export default OverlayNotes;
