import { readFileSync } from 'fs';

const content = readFileSync('/Users/debabratanayak_1/Documents/School_Mgmt/proctira-unified/apps/web/src/app/(dashboard)/institutions/[id]/infrastructure/page.tsx', 'utf8');
const lines = content.split('\n');

const TW_PHYSICAL = /(?<![a-z-])(?:ml|mr|pl|pr)-(?:\[.*?\]|\d+(?:\/\d+)?(?:\.\d+)?)/g;
const TW_BORDER = /(?<![a-z-])border-(?:l|r)(?:-(?:\[.*?\]|\d+)|(?=[\s"'`]|$))/g;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  let match;
  
  const r1 = new RegExp(TW_PHYSICAL.source, 'g');
  while ((match = r1.exec(line)) !== null) {
    const before = line.slice(0, match.index);
    if (/(?:slide-(?:in-from|out-to)-|from-|to-)$/.test(before)) continue;
    console.log(`TW Physical L${i+1}: [${match[0]}] ctx: ${line.slice(Math.max(0,match.index-10), match.index+match[0].length+5)}`);
  }
  
  const r2 = new RegExp(TW_BORDER.source, 'g');
  while ((match = r2.exec(line)) !== null) {
    console.log(`TW Border L${i+1}: [${match[0]}] ctx: ${line.slice(Math.max(0,match.index-10), match.index+match[0].length+5)}`);
  }
}
