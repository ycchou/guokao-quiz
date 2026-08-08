// Shared types (no node deps) usable in both Astro SSR and React islands.
export type QMode = 'text' | 'image' | 'text_uncertain' | 'scanned';
export interface Question {
  no: number;
  answer: string | null;
  corrected: boolean;
  note: string | null;
  mode: QMode;
  stem?: string;
  options?: Record<string, string>;
  img?: string;
  explanation?: string | null; // AI 輔助解析（可為空）
}
export interface Subject {
  id: string;
  profession: string;
  minguo: number;
  year: number;
  session: string;
  examCode: string;
  examName: string;
  subjectNo: number;
  subject: string;
  subjectShort: string;
  timeLimitMin?: number;
  declared: number | null;
  isEssay?: boolean;
  scanned?: boolean;
  source: { question: string | null; answer: string | null; errata: string | null };
  questions: Question[];
  pageImages?: string[];
  stats: Record<string, number>;
}
export interface SubjectRef {
  no: number; subject: string; short: string; file: string;
  count: number; answered: number; img: number; isEssay: boolean;
}
export interface ExamEntry {
  minguo: number; year: number; session: string; examName: string; subjects: SubjectRef[];
}
export interface IndexData {
  professions: Record<string, { exams: Record<string, ExamEntry> }>;
  generatedAt: string;
}

export const PROF_SLUG: Record<string, string> = { '護理師': 'nurse', '呼吸治療師': 'rt' };
export const SLUG_PROF: Record<string, string> = { nurse: '護理師', rt: '呼吸治療師' };
