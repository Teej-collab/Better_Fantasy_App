// Owner photos for the trading cards, keyed by owner_id — same map as
// the web's TeamProfileCard.tsx OWNER_PHOTOS (files copied from
// frontend/public/images/owners). Owners without one get initials.
export const OWNER_PHOTOS: Record<number, number> = {
  5: require('@/assets/images/owners/clay-felice.jpg'), // Clay Felice
  44: require('@/assets/images/owners/brian-thomas.jpg'), // Brian Thomas
  12: require('@/assets/images/owners/ian-parkinson.jpg'), // Ian Parkinson
  3: require('@/assets/images/owners/bailey-hawn.jpg'), // Bailey Hawn
  11: require('@/assets/images/owners/bowmen-solari.jpg'), // Bowmen "Bo" Solari
  10: require('@/assets/images/owners/jeffrey-horak.jpg'), // Jeffrey "Jeff" Horak
  8: require('@/assets/images/owners/aaron-wylie.jpg'), // Aaron Wylie
  15: require('@/assets/images/owners/aaron-roberts.jpg'), // Aaron Roberts
  20: require('@/assets/images/owners/tyler-dailey.jpg'), // Tyler Dailey
  9: require('@/assets/images/owners/james-hogan.jpg'), // James "Jimmy" Hogan
  2: require('@/assets/images/owners/lorenzo-cachia.jpg'), // Lorenzo Cachia
  1: require('@/assets/images/owners/niko.jpg'), // Niko
  4: require('@/assets/images/owners/tj.jpg'), // TJ
  7: require('@/assets/images/owners/ryan-horak.jpg'), // Ryan Horak
  6: require('@/assets/images/owners/grant-pomerenk.jpg'), // Grant Pomerenk
};
