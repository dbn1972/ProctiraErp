/**
 * CSV Source Connector Unit Tests
 */
import { describe, it, expect } from 'vitest';
import { CsvSourceConnector } from './csv-source.js';

describe('CsvSourceConnector', () => {
  describe('extract', () => {
    it('should parse CSV with headers', async () => {
      const connector = new CsvSourceConnector({
        type: 'csv',
        fileContent: 'name,age,city\nJohn,30,NYC\nJane,25,LA',
        hasHeader: true,
      });

      const result = await connector.extract();

      expect(result.totalCount).toBe(2);
      expect(result.rows).toEqual([
        { name: 'John', age: '30', city: 'NYC' },
        { name: 'Jane', age: '25', city: 'LA' },
      ]);
    });

    it('should parse CSV without headers', async () => {
      const connector = new CsvSourceConnector({
        type: 'csv',
        fileContent: 'John,30,NYC\nJane,25,LA',
        hasHeader: false,
      });

      const result = await connector.extract();

      expect(result.totalCount).toBe(2);
      expect(result.rows).toEqual([
        { col_0: 'John', col_1: '30', col_2: 'NYC' },
        { col_0: 'Jane', col_1: '25', col_2: 'LA' },
      ]);
    });

    it('should handle custom delimiter', async () => {
      const connector = new CsvSourceConnector({
        type: 'csv',
        fileContent: 'name;age;city\nJohn;30;NYC',
        hasHeader: true,
        delimiter: ';',
      });

      const result = await connector.extract();

      expect(result.totalCount).toBe(1);
      expect(result.rows[0]).toEqual({ name: 'John', age: '30', city: 'NYC' });
    });

    it('should handle quoted fields', async () => {
      const connector = new CsvSourceConnector({
        type: 'csv',
        fileContent: 'name,description\nJohn,"Hello, World"\nJane,"She said ""hi"""',
        hasHeader: true,
      });

      const result = await connector.extract();

      expect(result.totalCount).toBe(2);
      expect(result.rows[0]!.description).toBe('Hello, World');
      expect(result.rows[1]!.description).toBe('She said "hi"');
    });

    it('should handle empty content', async () => {
      const connector = new CsvSourceConnector({
        type: 'csv',
        fileContent: '',
        hasHeader: true,
      });

      const result = await connector.extract();

      expect(result.totalCount).toBe(0);
      expect(result.rows).toEqual([]);
    });

    it('should skip empty lines', async () => {
      const connector = new CsvSourceConnector({
        type: 'csv',
        fileContent: 'name,age\nJohn,30\n\nJane,25\n',
        hasHeader: true,
      });

      const result = await connector.extract();

      expect(result.totalCount).toBe(2);
    });

    it('should handle missing values', async () => {
      const connector = new CsvSourceConnector({
        type: 'csv',
        fileContent: 'name,age,city\nJohn,,NYC\nJane,25,',
        hasHeader: true,
      });

      const result = await connector.extract();

      expect(result.rows[0]!.age).toBe('');
      expect(result.rows[1]!.city).toBe('');
    });
  });

  describe('validate', () => {
    it('should pass validation with fileContent', async () => {
      const connector = new CsvSourceConnector({
        type: 'csv',
        fileContent: 'a,b\n1,2',
      });

      const result = await connector.validate();
      expect(result.valid).toBe(true);
    });

    it('should pass validation with filePath', async () => {
      const connector = new CsvSourceConnector({
        type: 'csv',
        filePath: '/path/to/file.csv',
      });

      const result = await connector.validate();
      expect(result.valid).toBe(true);
    });

    it('should fail validation without filePath or fileContent', async () => {
      const connector = new CsvSourceConnector({
        type: 'csv',
      });

      const result = await connector.validate();
      expect(result.valid).toBe(false);
      expect(result.error).toContain('required');
    });
  });
});
