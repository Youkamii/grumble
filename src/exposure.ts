/**
 * 노출 기록. publish가 commit한 문장 id와 시각을 ~/.grumble/exposure.json 에 남기고 select가 읽는다.
 *  - 24시간 안에 노출된 문장은 그대로 유지된다(sticky). 매 발행마다 말풍선이 통째로 갈리지 않게.
 *  - 그 뒤 COOLDOWN_DAYS 동안은 1차 후보에서 빠진다(cooling). 역대 1등이 영구 전시되지 않게.
 *  - 기록은 commit 시점에만 갱신한다. render/preview만 돌린 것은 노출이 아니다.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { stateDir } from "./util.ts";
import { COOLDOWN_DAYS, type Exposure } from "./select.ts";

export interface ExposureCache {
  version: 1;
  items: Record<string, Exposure>;
}

export function exposurePath(): string { return join(stateDir(), "exposure.json"); }

export function emptyExposure(): ExposureCache { return { version: 1, items: {} }; }

export function loadExposure(path = exposurePath()): ExposureCache {
  if (!existsSync(path)) return emptyExposure();
  try {
    const c = JSON.parse(readFileSync(path, "utf8"));
    if (c?.version === 1 && c.items && typeof c.items === "object") return c as ExposureCache;
  } catch { /* corrupted → fresh */ }
  return emptyExposure();
}

export function saveExposure(cache: ExposureCache, path = exposurePath()): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(cache), { mode: 0o600 });
  renameSync(tmp, path);
}

/** 쿨다운이 끝난 지 한참 된 항목은 더 볼 일이 없다. 파일이 자라지 않게 이 기간 뒤 버린다. */
export const PRUNE_DAYS = COOLDOWN_DAYS * 2;

/**
 * 이번 발행에 실린 id를 기록한다. 처음 실린 시각(first)은 보존하고 마지막 시각(last)만 갱신한다.
 * last가 PRUNE_DAYS보다 오래된 항목은 지운다.
 */
export function recordExposure(cache: ExposureCache, ids: Iterable<string>, at: Date): ExposureCache {
  const iso = at.toISOString();
  for (const id of ids) {
    const prev = cache.items[id];
    cache.items[id] = { first: prev?.first ?? iso, last: iso };
  }
  const cutoff = at.getTime() - PRUNE_DAYS * 86_400_000;
  for (const [id, e] of Object.entries(cache.items)) {
    const t = Date.parse(e.last);
    if (!Number.isFinite(t) || t < cutoff) delete cache.items[id];
  }
  return cache;
}

export function exposureMap(cache: ExposureCache = loadExposure()): Map<string, Exposure> {
  return new Map(Object.entries(cache.items));
}
