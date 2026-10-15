import fs from 'node:fs';
const p = 'packages/app-shell/src/archive-cleanup.ts';
let s = fs.readFileSync(p, 'utf8');
s = s.replace(
  `      version: number; updatedAt: string;
      hard: Array<{ id: string; rule: string; level: string; source: string }>;`,
  `      version: number; updatedAt: string;
      rules?: RuanMenJinGuiZe[];
      hard: Array<{ id: string; rule: string; level: string; source: string }>;`
);
fs.writeFileSync(p, s, 'utf8');
console.log('type rules added');
