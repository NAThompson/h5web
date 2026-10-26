/* Glasbey-style table of 128 distinct colors for categories (e.g. classes of a segmentation
 * mask): Tableau10 first, then each color farthest in CIELAB from those before it, among sRGB
 * colors of lightness 30–88 and chroma ≥ 20 (not near black, white or gray, kept for NaN and
 * backgrounds) - greedy farthest-point sampling, as Glasbey et al. (2007) */
// prettier-ignore
export const GLASBEY = [
  '#4e79a7', '#f28e2c', '#e15759', '#76b7b2', '#59a14f', '#edc949', '#af7aa1', '#ff9da7',
  '#9c755f', '#bab0ab', '#1600ff', '#ff16e9', '#00ff00', '#856fff', '#ff0000', '#bc007a',
  '#b1e90b', '#00f4bc', '#ff90ff', '#005943', '#6f2c85', '#7a6f00', '#9000d3', '#0090ff',
  '#6ff46f', '#853700', '#00c8ff', '#852c43', '#d3de9b', '#bcc8ff', '#0b43a6', '#ffbc85',
  '#ff006f', '#9b85de', '#b10000', '#0037e9', '#85a60b', '#43f4f4', '#4e4e21', '#b121b1',
  '#594364', '#009b00', '#005900', '#ff7abc', '#ffbcff', '#ff2143', '#009b7a', '#859b6f',
  '#9be9bc', '#b1e97a', '#642cb1', '#ff642c', '#ff2cbc', '#167a85', '#0bc86f', '#d37a4e',
  '#c864ff', '#bc59b1', '#e9de00', '#b19b59', '#900021', '#64de0b', '#852164', '#bc2159',
  '#9be9ff', '#ffb100', '#b17a16', '#004e90', '#ffd3bc', '#6fb1ff', '#ffc8de', '#6f4321',
  '#bc6464', '#de00ff', '#214e64', '#004ede', '#bc4e00', '#850bff', '#9bb159', '#ff439b',
  '#597a16', '#bc5985', '#854eff', '#9059c8', '#7ab1d3', '#855964', '#d3de59', '#6f599b',
  '#ff6f90', '#ff64f4', '#85f49b', '#00bcc8', '#a69b16', '#436f37', '#436fe9', '#6fbc43',
  '#00f44e', '#d30043', '#4e856f', '#43d3b1', '#007ac8', '#de9b85', '#e9d37a', '#9090c8',
  '#f49bc8', '#ff7a59', '#9b6f37', '#c885ff', '#9b1685', '#9be94e', '#64bc85', '#009bbc',
  '#c885d3', '#e9a64e', '#596fc8', '#b1432c', '#a6c8a6', '#16c82c', '#c88590', '#008521',
  '#c82cde', '#590bd3', '#c8a6d3', '#b1c800', '#ff7a00', '#90e9de', '#644e00', '#7a0b90',
];
