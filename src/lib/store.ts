// localStorage persistence: attempt history, wrong-answer book, bookmarks.
export interface AttemptQ {
  prof: string; file: string; no: number;
  picked: string | null; answer: string | null; correct: boolean;
}
export interface Attempt {
  id: string;
  mode: 'practice' | 'mock' | 'random';
  title: string;
  ts: number;
  total: number;
  correct: number;
  answered: number;
  durationSec?: number;
  items: AttemptQ[];
}

const K_ATTEMPTS = 'gq.attempts';
const K_WRONG = 'gq.wrong';
const K_MARK = 'gq.marks';

function read<T>(k: string, def: T): T {
  if (typeof localStorage === 'undefined') return def;
  try { return JSON.parse(localStorage.getItem(k) || '') as T; } catch { return def; }
}
function write(k: string, v: unknown) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota */ }
}

// ---- attempts ----
export function getAttempts(): Attempt[] { return read<Attempt[]>(K_ATTEMPTS, []); }
export function saveAttempt(a: Attempt) {
  const list = getAttempts();
  list.unshift(a);
  write(K_ATTEMPTS, list.slice(0, 200));
  // update wrong-book
  const wrong = getWrong();
  for (const it of a.items) {
    const key = `${it.prof}|${it.file}|${it.no}`;
    if (!it.correct && it.picked != null) wrong[key] = { ...it, ts: a.ts };
    else if (it.correct) delete wrong[key]; // 答對就移出錯題本
  }
  write(K_WRONG, wrong);
}
export function clearAttempts() { write(K_ATTEMPTS, []); }
export function removeAttempt(id: string) {
  write(K_ATTEMPTS, getAttempts().filter((a) => a.id !== id));
}

// ---- wrong book ----
export type WrongMap = Record<string, AttemptQ & { ts: number }>;
export function getWrong(): WrongMap { return read<WrongMap>(K_WRONG, {}); }
export function removeWrong(key: string) { const w = getWrong(); delete w[key]; write(K_WRONG, w); }

// ---- bookmarks ----
export function getMarks(): Record<string, { prof: string; file: string; no: number; ts: number }> {
  return read(K_MARK, {});
}
export function toggleMark(prof: string, file: string, no: number): boolean {
  const m = getMarks(); const key = `${prof}|${file}|${no}`;
  if (m[key]) { delete m[key]; write(K_MARK, m); return false; }
  m[key] = { prof, file, no, ts: Date.now() }; write(K_MARK, m); return true;
}
export function isMarked(prof: string, file: string, no: number): boolean {
  return !!getMarks()[`${prof}|${file}|${no}`];
}

// ---- 匯出 / 匯入 ----
export interface ExportBundle {
  app: 'guokao-quiz'; version: 1; exportedAt: number;
  attempts: Attempt[]; wrong: WrongMap; marks: ReturnType<typeof getMarks>;
}
export function exportAll(): ExportBundle {
  return { app: 'guokao-quiz', version: 1, exportedAt: Date.now(), attempts: getAttempts(), wrong: getWrong(), marks: getMarks() };
}
export function importAll(data: any, mode: 'merge' | 'replace'): { attempts: number; wrong: number; marks: number } {
  if (!data || data.app !== 'guokao-quiz') throw new Error('檔案格式不符（不是本站的紀錄檔）');
  const inAtt: Attempt[] = Array.isArray(data.attempts) ? data.attempts : [];
  const inWrong: WrongMap = data.wrong || {};
  const inMarks = data.marks || {};
  if (mode === 'replace') {
    write(K_ATTEMPTS, inAtt.slice(0, 200)); write(K_WRONG, inWrong); write(K_MARK, inMarks);
  } else {
    const seen = new Set(getAttempts().map((a) => a.id));
    const mergedAtt = [...getAttempts(), ...inAtt.filter((a) => !seen.has(a.id))]
      .sort((a, b) => b.ts - a.ts).slice(0, 200);
    write(K_ATTEMPTS, mergedAtt);
    write(K_WRONG, { ...getWrong(), ...inWrong });
    write(K_MARK, { ...getMarks(), ...inMarks });
  }
  return { attempts: inAtt.length, wrong: Object.keys(inWrong).length, marks: Object.keys(inMarks).length };
}
