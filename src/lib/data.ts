import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), 'public', 'data');

export type SubjectRef = {
  no: number; subject: string; short: string; file: string;
  count: number; answered: number; img: number; isEssay: boolean;
};
export type ExamEntry = {
  minguo: number; year: number; session: string; examName: string;
  subjects: SubjectRef[];
};
export type IndexData = {
  professions: Record<string, { exams: Record<string, ExamEntry> }>;
  generatedAt: string;
};

export type Question = {
  no: number; answer: string | null; corrected: boolean; note: string | null;
  mode: 'text' | 'image' | 'text_uncertain' | 'scanned';
  stem?: string; options?: Record<string, string>; img?: string;
};
export type Subject = {
  id: string; profession: string; minguo: number; year: number; session: string;
  examCode: string; examName: string; subjectNo: number; subject: string;
  subjectShort: string; timeLimitMin?: number; declared: number | null;
  format?: string; isEssay?: boolean; scanned?: boolean;
  source: { question: string | null; answer: string | null; errata: string | null };
  questions: Question[]; pageImages?: string[];
  stats: Record<string, number>;
};

let _index: IndexData | null = null;
export function loadIndex(): IndexData {
  if (!_index) _index = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'index.json'), 'utf-8'));
  return _index!;
}

// ---- profession slug mapping (clean ASCII URLs / folders) ----
export const PROF_SLUG: Record<string, string> = { '護理師': 'nurse', '呼吸治療師': 'rt' };

export function loadSubject(prof: string, file: string): Subject {
  const slug = PROF_SLUG[prof] || prof;
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'questions', slug, file), 'utf-8'));
}
export const SLUG_PROF: Record<string, string> = Object.fromEntries(
  Object.entries(PROF_SLUG).map(([k, v]) => [v, k])
);
export const PROF_DESC: Record<string, string> = {
  '護理師': '護理師國考（專技高考）歷屆試題，涵蓋基礎醫學、內外科、產兒科、精神科與社區衛生護理學等五大考科。',
  '呼吸治療師': '呼吸治療師國考（專技高考）歷屆試題，涵蓋心肺基礎醫學、呼吸治療學、呼吸器原理、重症呼吸治療學等六大考科。',
};

export function professions(): { name: string; slug: string; examCount: number; subjectCount: number; qCount: number }[] {
  const idx = loadIndex();
  return Object.entries(idx.professions).map(([name, p]) => {
    const exams = Object.values(p.exams);
    return {
      name, slug: PROF_SLUG[name] || name,
      examCount: exams.length,
      subjectCount: exams.reduce((a, e) => a + e.subjects.length, 0),
      qCount: exams.reduce((a, e) => a + e.subjects.reduce((b, s) => b + s.count, 0), 0),
    };
  });
}

export function examsOf(prof: string): [string, ExamEntry][] {
  const idx = loadIndex();
  const p = idx.professions[prof];
  if (!p) return [];
  return Object.entries(p.exams).sort((a, b) =>
    b[0].localeCompare(a[0])); // newest exam code first
}

export function sessionOrder(examCode: string): number {
  return parseInt(examCode.slice(3), 10);
}
