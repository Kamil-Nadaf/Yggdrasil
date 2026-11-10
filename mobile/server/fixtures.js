// Offline sample so the app is usable (and testable) when arXiv cannot be reached.
const iso = (d) => new Date(Date.now() - d * 3600e3).toISOString();

export const SAMPLE = [
  ['Pulse shapes in prompt emission of bright bursts', 'We fit individual pulses in a sample of bright bursts and compare single and multi-pulse descriptions of the light curves. A multi-pulse model is preferred in a large fraction of cases, and we discuss what the pulse shapes imply for the emission region and the radiation mechanism.'],
  ['Spectral lags and the origin of the prompt emission', 'We measure spectral lags across energy bands and discuss what they imply for the emission region and radiation mechanism.'],
  ['Search for counterparts to a short burst', 'We report a search for electromagnetic and neutrino counterparts to a short burst and place limits on the associated emission.'],
  ['Constraints on jet structure from afterglow data', 'Afterglow light curves are used to constrain the angular structure of the jet and the viewing angle for a sample of bursts.'],
  ['Minimum variability timescales in gamma-ray burst light curves', 'We revisit estimates of the minimum variability timescale and examine biases introduced by binning and background subtraction.'],
  ['Photospheric emission in burst spectra', 'We test whether a photospheric component improves fits to time-resolved spectra of bright bursts.'],
].map(([title, abstract], i) => ({
  id: `sample-${i + 1}`,
  title,
  abstract,
  authors: ['Author A.', 'Author B.'],
  published: iso(i * 3 + 1),
  pdf: '',
}));
