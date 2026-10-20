import LabelledRange from '../LabelledRange';

const MIN = 0.05;
const MAX = 2;

interface Props {
  value: number;
  onChange: (value: number) => void;
}

function HeightScaleSlider(props: Props) {
  const { value, onChange } = props;

  return (
    <LabelledRange
      label="Height"
      ariaLabel="Height scale"
      min={MIN}
      max={MAX}
      step={0.05}
      value={value}
      format={(val) => `×${val.toFixed(2)}`}
      onChange={onChange}
    />
  );
}

export default HeightScaleSlider;
