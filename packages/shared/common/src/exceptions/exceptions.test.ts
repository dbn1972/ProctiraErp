import { describe, it, expect } from 'vitest';

import { ErrorCode } from '../constants/index.js';

import {
  AppError,
  ValidationError,
  ConflictError,
  NotFoundError,
  BusinessRuleError,
} from './index.js';

describe('AppError', () => {
  it('should create an error with all properties', () => {
    const error = new AppError('Something went wrong', 'CUSTOM_ERROR', 500);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AppError);
    expect(error.message).toBe('Something went wrong');
    expect(error.code).toBe('CUSTOM_ERROR');
    expect(error.statusCode).toBe(500);
    expect(error.errors).toBeUndefined();
    expect(error.name).toBe('AppError');
  });

  it('should serialize to JSON without errors field when no field errors', () => {
    const error = new AppError('Test error', 'TEST', 400);
    const json = error.toJSON();

    expect(json).toEqual({
      code: 'TEST',
      message: 'Test error',
      statusCode: 400,
    });
  });

  it('should serialize to JSON with errors field when field errors present', () => {
    const fieldErrors = [{ field: 'email', rule: 'format', message: 'Invalid email format' }];
    const error = new AppError('Validation failed', 'VALIDATION_ERROR', 400, fieldErrors);
    const json = error.toJSON();

    expect(json).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      statusCode: 400,
      errors: fieldErrors,
    });
  });
});

describe('ValidationError', () => {
  it('should have correct defaults', () => {
    const error = new ValidationError();

    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.message).toBe('Validation failed');
    expect(error.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(error.statusCode).toBe(400);
    expect(error.errors).toEqual([]);
    expect(error.name).toBe('ValidationError');
  });

  it('should accept custom message and field errors', () => {
    const fieldErrors = [
      { field: 'body.name', rule: 'required', message: 'Name is required' },
      { field: 'body.email', rule: 'format', message: 'Invalid email' },
    ];
    const error = new ValidationError('Input validation failed', fieldErrors);

    expect(error.message).toBe('Input validation failed');
    expect(error.errors).toEqual(fieldErrors);
    expect(error.statusCode).toBe(400);
  });

  it('should be catchable as Error', () => {
    const error = new ValidationError();
    expect(error instanceof Error).toBe(true);
  });
});

describe('ConflictError', () => {
  it('should have correct defaults', () => {
    const error = new ConflictError();

    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(ConflictError);
    expect(error.message).toBe('Resource conflict');
    expect(error.code).toBe(ErrorCode.CONFLICT);
    expect(error.statusCode).toBe(409);
    expect(error.name).toBe('ConflictError');
  });

  it('should accept custom message', () => {
    const error = new ConflictError('Institution code already exists');
    expect(error.message).toBe('Institution code already exists');
  });
});

describe('NotFoundError', () => {
  it('should have correct defaults', () => {
    const error = new NotFoundError();

    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error.message).toBe('Resource not found');
    expect(error.code).toBe(ErrorCode.NOT_FOUND);
    expect(error.statusCode).toBe(404);
    expect(error.name).toBe('NotFoundError');
  });

  it('should accept custom message', () => {
    const error = new NotFoundError('Student not found');
    expect(error.message).toBe('Student not found');
  });
});

describe('BusinessRuleError', () => {
  it('should have correct defaults', () => {
    const error = new BusinessRuleError();

    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(BusinessRuleError);
    expect(error.message).toBe('Business rule violation');
    expect(error.code).toBe(ErrorCode.BUSINESS_RULE_ERROR);
    expect(error.statusCode).toBe(422);
    expect(error.name).toBe('BusinessRuleError');
  });

  it('should accept custom message', () => {
    const error = new BusinessRuleError('Academic period is not active');
    expect(error.message).toBe('Academic period is not active');
  });
});
