/** 추론 요약 한 건. 로컬 state에만 저장되며 공개물에는 mask/select를 거친 문장만 나간다. */
export interface GrumbleRecord {
  /** source+timestamp+text 해시. 세션 resume로 복제된 레코드 중복 제거용. */
  id: string;
  source: "codex" | "claude";
  /** ISO 8601 */
  ts: string;
  /** 원문(요약 전체). 굵은 제목 등 정리 전. */
  text: string;
  cwd: string;
  session: string;
  model: string;
}

export interface FileCursor {
  size: number;
  offset: number;
  mtimeMs: number;
}

export interface State {
  version: 1;
  scannedAt: string | null;
  files: Record<string, FileCursor>;
  records: GrumbleRecord[];
}
