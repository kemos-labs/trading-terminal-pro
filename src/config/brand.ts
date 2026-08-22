/**
 * Product brand + founder credits (boot screen, about chrome).
 * Override X handle with VITE_FOUNDER_X_URL if needed.
 */

export const BRAND = {
  productName: 'Kemos Research',
  tagline: 'Options · Positioning · Rates',
  founderName: 'levered β LARP e/acc',
  founderRole: 'Founder',
  /** Public X profile — override via VITE_FOUNDER_X_URL at build time. */
  founderXUrl:
    (typeof import.meta !== 'undefined' &&
      (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_FOUNDER_X_URL) ||
    'https://x.com/0xDrdegen',
  founderXHandle:
    (typeof import.meta !== 'undefined' &&
      (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_FOUNDER_X_HANDLE) ||
    '@0xDrdegen',
  bootMemeSrc: '/boot-meme.jpg',
  bootMemeAlt: 'The only 3 things you need: vol surface · exercise · sleep',
} as const;
