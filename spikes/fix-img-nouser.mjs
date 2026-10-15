import fs from 'node:fs';
const p = 'packages/providers/src/ollama.ts';
let s = fs.readFileSync(p, 'utf8');
const oldS = [
  '    // 图片挂到第一条 user',
  '    if (tuZhuanYi.length) {',
  '      const u = out.find((x) => x.role === \'user\');',
  '      if (u) {',
  '        const yi = Array.isArray(u.images) ? (u.images as string[]) : [];',
  '        u.images = [...yi, ...tuZhuanYi];',
  '      }',
  '    }',
].join('\n');
const newS = [
  '    // 图片挂到第一条 user（没有 user 就挂到后面补的那条，绝不丢图）',
  '    if (tuZhuanYi.length) {',
  '      const u = out.find((x) => x.role === \'user\');',
  '      if (u) {',
  '        const yi = Array.isArray(u.images) ? (u.images as string[]) : [];',
  '        u.images = [...yi, ...tuZhuanYi];',
  '      } else {',
  '        out.push({ role: \'user\', content: \'请查看附带的图片，并继续完成用户交代的任务。\', images: tuZhuanYi });',
  '      }',
  '    }',
].join('\n');
const n = s.split(oldS).length - 1;
console.log('hits', n);
if (n === 1) {
  s = s.replace(oldS, newS);
  fs.writeFileSync(p, s, 'utf8');
  console.log('image-no-user fixed');
}
