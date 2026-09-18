export const characterImageTypes = {
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
} as const;

export type CharacterImageFormat = keyof typeof characterImageTypes;

export function characterImageFormat(filename: string): CharacterImageFormat | undefined {
  const extension = filename.split('.').at(-1);
  return extension === 'png' || extension === 'gif' || extension === 'webp' ? extension : undefined;
}
