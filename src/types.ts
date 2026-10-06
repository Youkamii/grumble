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
  /** 원격 기계에서 가져온 로그면 그 ssh 별칭. 로컬은 undefined. 공개물에는 내보내지 않는다. */
  host?: string;
  /** 레코드 종류. 없으면 추론 요약(thinking). confession은 답변 본문의 정정·자백 문장(#10). */
  kind?: "confession";
}

export interface FileCursor {
  size: number;
  offset: number;
  mtimeMs: number;
  ctx?: { cwd: string; session: string; model: string };
}

export interface State {
  /** 2: 정정·자백 채널 도입. 1 → 2 마이그레이션은 Claude 커서를 비워 한 번 재스캔한다(scan.ts). */
  version: 2;
  scannedAt: string | null;
  files: Record<string, FileCursor>;
  records: GrumbleRecord[];
}
