// Browser-side data fetching (static JSON under /data).
import type { IndexData, Subject } from './types';
import { PROF_SLUG } from './types';

const base = import.meta.env.BASE_URL.replace(/\/$/, '');

let _idx: Promise<IndexData> | null = null;
export function fetchIndex(): Promise<IndexData> {
  if (!_idx) _idx = fetch(`${base}/data/index.json`).then((r) => r.json());
  return _idx;
}

const _subCache = new Map<string, Promise<Subject>>();
export function fetchSubject(prof: string, file: string): Promise<Subject> {
  const slug = PROF_SLUG[prof] || prof;
  const key = `${slug}/${file}`;
  if (!_subCache.has(key))
    _subCache.set(key, fetch(`${base}/data/questions/${slug}/${file}`).then((r) => r.json()));
  return _subCache.get(key)!;
}

export function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
