export const kebab = (s: string): string =>
  s.trim().replace(/\s+/g, '-').toLowerCase()
