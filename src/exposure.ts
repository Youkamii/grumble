/**
 * 노출 기록. publish가 commit한 문장 id와 시각을 ~/.grumble/exposure.json 에 남기고 select가 읽는다.
 *  - first: 연속 노출이 시작된 시각. 이로부터 STICKY_HOURS 안이면 sticky(자리를 지킨다).
 *    last가 아니라 first로 재야 다른 슬롯이 바뀌어 commit이 잦아도 sticky가 연장되지 않는다.
 *  - last: 마지막으로 실린 시각. 이로부터 COOLDOWN_DAYS 동안 cooling(0~2단계 후보에서 빠진다).
 *  - 기록은 commit 시점에만 갱신한다. render/preview만 돌린 것은 노출이 아니다.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { saveJsonAtomic, stateDir } from "./util.ts";
import { ageDays, COOLDOWN_DAYS, STICKY_HOURS, type Exposure } from "./select.ts";

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
  saveJsonAtomic(path, cache);
}

/** 쿨다운이 끝난 항목은 select에 보이지 않으므로 더 둘 이유가 없다. 하루 여유만 두고 버린다. */
export const PRUNE_DAYS = COOLDOWN_DAYS + 1;

/**
 * 이번 발행에 실린 id를 기록한다. 직전 commit(STICKY_HOURS 안)에도 실려 있었으면 같은 연속 노출이라 first를 지키고,
 * 쉬었다 돌아온 문장은 first를 새로 센다. last는 항상 지금. last가 PRUNE_DAYS보다 오래된 항목은 지운다.
 */
export function recordExposure(cache: ExposureCache, ids: Iterable<string>, at: Date): ExposureCache {
  const iso = at.toISOString();
  for (const id of ids) {
    const prev = cache.items[id];
    const continuous = prev !== undefined && ageDays(prev.last, at) * 24 < STICKY_HOURS;
    cache.items[id] = { first: continuous ? prev.first : iso, last: iso };
  }
  for (const [id, e] of Object.entries(cache.items)) {
    if (ageDays(e.last, at) > PRUNE_DAYS) delete cache.items[id];
  }
  return cache;
}

export function exposureMap(cache: ExposureCache = loadExposure()): Map<string, Exposure> {
  return new Map(Object.entries(cache.items));
}
