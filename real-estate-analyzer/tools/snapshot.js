#!/usr/bin/env node
/*
 * 웹(GitHub Pages) 버전용 규제 변경 감지 스냅샷.
 * 서버가 없는 웹 버전을 위해 배포 작업이 6시간마다 이 스크립트로 조회해 data/regulation.json을 올린다.
 * 사용: node tools/snapshot.js <출력 폴더>
 */
const fs = require('fs');
const path = require('path');
const live = require('./live-data.js');

(async () => {
  const out = path.resolve(process.argv[2] || 'dist');
  fs.mkdirSync(path.join(out, 'data'), { recursive: true });
  let r;
  try {
    const limit = new Promise((_, rej) => setTimeout(() => rej(new Error('조회 시간 초과 (3분)')), 180e3).unref());
    r = await Promise.race([live.regulationCheck(live.loadConfig(), true), limit]);
  } catch (err) {
    r = { ok: false, checkedAt: new Date().toISOString(), checked: [], changes: [], errors: [err.message] };
  }
  r.snapshot = true;
  fs.writeFileSync(path.join(out, 'data', 'regulation.json'), JSON.stringify(r, null, 1));
  console.log(`규제 스냅샷: ${r.checked.join(', ') || '확인 없음'} · 변경 ${r.changes.length}건 · 오류 ${r.errors.length}건`);
  r.errors.forEach((e) => console.log('  오류: ' + e));
  process.exit(0); // 남은 연결이 있어도 배포를 막지 않는다
})();
