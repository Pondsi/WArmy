import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-test-'));
const { KnowledgeBase } = await import('file:///C:/wbuild/packages/knowledge-base/dist/index.js');
const kb = new KnowledgeBase(dir);
kb.upsertEntity({ id: 'a', kind: 'project', ming: 'x', attrs: {}, anchors: [] });
console.log('write ok, file exists:', fs.existsSync(path.join(dir, 'knowledge.json')));

// Now delete the dir entirely (simulate first-run wipe / external cleanup)
fs.rmSync(dir, { recursive: true, force: true });
console.log('dir removed:', !fs.existsSync(dir));

// This used to throw ENOENT and break the whole chat round
try {
  kb.upsertEntity({ id: 'b', kind: 'project', ming: 'y', attrs: {}, anchors: [] });
  const healed = fs.existsSync(path.join(dir, 'knowledge.json'));
  console.log('after external delete -> upsert:', healed ? 'SELF-HEALED (no throw)' : 'no throw but not written');
  if (!healed) process.exit(1);
} catch (e) {
  console.log('STILL THROWS:', String(e.message).slice(0, 120));
  process.exit(1);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log('PASS');
