import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

describe('Error Handler Middleware', () => {
  let mockReq, mockRes;

  beforeEach(() => {
    mockReq = { method: 'GET', url: '/test', headers: {} };
    mockRes = {
      statusCode: 200,
      body: '',
      setHeader(name, value) { this._headers = { ...(this._headers || {}), [name]: value }; },
      writeHead(code, headers) { this.statusCode = code; this._headers = headers; },
      end(data) { this.body = data; },
      json(data) { this.body = JSON.stringify(data); },
      _headers: {}
    };
  });

  it('createErrorHandler should return a working function when res is provided', async () => {
    const { createErrorHandler } = await import('../../app/middleware/error-handler.js');
    const handler = createErrorHandler(mockRes);
    assert.strictEqual(typeof handler, 'function');
  });

  it('should log the error message correctly (not undefined)', async () => {
    const { errorHandler } = await import('../../app/middleware/error-handler.js');
    const { AppError } = await import('../../app/errors.js');
    const error = new AppError('Test error message', { statusCode: 400 });
    
    let loggedMessage = null;
    const origWarn = console.warn;
    console.warn = (msg) => { loggedMessage = msg; };
    
    // errorHandler signature is (error, res, req)
    errorHandler(error, mockRes, mockReq);
    console.warn = origWarn;
    
    assert.ok(loggedMessage !== null, 'console.warn should be called for 4xx errors');
    assert.ok(
      loggedMessage.includes('Test error message'),
      `Error message should be logged, got: "${loggedMessage}"`
    );
  });

  it('asyncHandler should catch and handle errors from async functions', async () => {
    const { asyncHandler } = await import('../../app/middleware/error-handler.js');
    const { NotFoundError } = await import('../../app/errors.js');
    const asyncFn = async (req, res, next) => {
      throw new NotFoundError('Not found');
    };
    const wrapped = asyncHandler(asyncFn);
    
    let responseBody = null;
    const mockResWithCapture = {
      statusCode: 200,
      body: '',
      _headers: {},
      setHeader(name, value) { this._headers[name] = value; },
      writeHead(code, headers) { this.statusCode = code; this._headers = headers || {}; },
      end(data) { this.body = data; if (data) { try { responseBody = JSON.parse(data); } catch {} } }
    };
    
    await wrapped(mockReq, mockResWithCapture);
    
    assert.ok(responseBody !== null, 'Response should be set');
    assert.strictEqual(responseBody.code, 'NOT_FOUND');
  });
});
