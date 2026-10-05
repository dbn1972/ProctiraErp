import { describe, expect, it } from 'vitest';
import { escapeCsv, generateCsv } from './generators.js';

describe('PRC-M341 CSV formula injection', () => {
  it.each(['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\tx', '\rx'])('neutralises %j', (v) => {
    expect(escapeCsv(v).replace(/^"|"$/g, '').startsWith("'")).toBe(true);
  });
  it.each(['-5', '-12.5', '42', '0.75'])('leaves plain number %j untouched', (v) => {
    expect(escapeCsv(v)).toBe(v);
  });
  it('does not double-prefix an already neutralised value', () => {
    expect(escapeCsv("'=1+1")).toBe("'=1+1");
  });

  it("exports '=1+1' as \"'=1+1\"", () => {
    const csv = generateCsv({
      columns: [{ name: 'a', label: 'A' }],
      rows: [{ a: '=1+1' }, { a: 'safe' }, { a: '=HYPERLINK("x","y")' }],
    }).toString('utf8');
    const lines = csv.split('\n');
    expect(lines[1]).toBe("'=1+1");
    expect(lines[2]).toBe('safe');
    expect(lines[3]).toBe('"\'=HYPERLINK(""x"",""y"")"');
  });
});
