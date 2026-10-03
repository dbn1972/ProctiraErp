import { describe, expect, it } from 'vitest';
import { csvCell } from './csv-cell';

describe('csvCell (PRC-M382)', () => {
  it('neutralises formula-leading text', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\tcmd')).toBe("'\tcmd");
  });
  it('keeps numbers and plain text, quotes separators', () => {
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell('Room 101')).toBe('Room 101');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell(null)).toBe('');
  });
});
