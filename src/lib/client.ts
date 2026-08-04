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

// 交卷後回報作答結果（匿名，供全站已答題數與錯誤率排名統計）
export function reportAnswers(items: { qid: string; prof: string; subject: string; correct: boolean }[]) {
  if (!items.length) return;
  try {
    fetch(`${base}/api/answers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
      keepalive: true,
    }).catch(() => {});
  } catch { /* ignore */ }
}

export function fetchRankings(params: Record<string, string>): Promise<{ rows: any[] }> {
  const q = new URLSearchParams(params).toString();
  return fetch(`${base}/api/rankings?${q}`).then((r) => r.json());
}

export function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
