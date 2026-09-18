import { multipartVolume } from './format.js';

interface ArchiveEntry {
  path: string;
  name: string;
}

/** 返回完整卷组和独立文件；已知缺主卷、断号或重号的整组均排除。 */
export function groupArchives<T extends ArchiveEntry>(files: readonly T[]): { sets: T[][]; incomplete: T[] } {
  const positions = new Map(files.map((file, index) => [file, index]));
  const byName = new Map<string, T[]>();
  const groups = new Map<string, { files: T[]; indices: number[]; first: number; companion?: string }>();
  for (const file of files) {
    const directory = parentPath(file.path);
    const nameKey = `${directory}\0${file.name.toLowerCase()}`;
    byName.set(nameKey, [...(byName.get(nameKey) ?? []), file]);
    const volume = multipartVolume(file.name);
    if (!volume) continue;
    const key = `${directory}\0${volume.format}\0${volume.group}`;
    const group = groups.get(key) ?? {
      files: [], indices: [], first: volume.firstIndex,
      companion: volume.companion ? `${directory}\0${volume.companion}` : undefined,
    };
    group.files.push(file);
    group.indices.push(volume.index);
    groups.set(key, group);
  }

  const sets: T[][] = [];
  const incomplete: T[] = [];
  const grouped = new Set<T>();
  for (const group of groups.values()) {
    const companions = group.companion ? byName.get(group.companion) ?? [] : [];
    const set = [...group.files, ...companions];
    set.forEach(file => grouped.add(file));
    const consecutive = group.indices.sort((a, b) => a - b).every((index, i) => index === group.first + i);
    if (!consecutive || (group.companion && companions.length !== 1)) {
      incomplete.push(...set);
    } else {
      sets.push(set.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })));
    }
  }
  for (const file of files) if (!grouped.has(file)) sets.push([file]);
  const position = (set: T[]) => Math.min(...set.map(file => positions.get(file)!));
  sets.sort((a, b) => position(a) - position(b));
  return { sets, incomplete };
}

export function parentPath(path: string): string {
  return path.slice(0, path.lastIndexOf('/'));
}
