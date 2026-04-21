/**
 * Error types for the CinePick addon.
 * Each error class carries context about what went wrong.
 */

export class AppError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "AppError";
    this.statusCode = options.statusCode || 500;
    this.code = options.code || "INTERNAL_ERROR";
    this.isOperational = options.isOperational !== false;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super(message, { statusCode: 404, code: "NOT_FOUND" });
    this.name = "NotFoundError";
  }
}

export class BadRequestError extends AppError {
  constructor(message = "Invalid request") {
    super(message, { statusCode: 400, code: "BAD_REQUEST" });
    this.name = "BadRequestError";
  }
}

export class ValidationError extends AppError {
  constructor(message, details = {}) {
    super(message, { statusCode: 422, code: "VALIDATION_ERROR" });
    this.name = "ValidationError";
    this.details = details;
  }
}

export class ProxyError extends AppError {
  constructor(message, options = {}) {
    super(message, { statusCode: options.statusCode || 502, code: "PROXY_ERROR", ...options });
    this.name = "ProxyError";
  }
}

export class ProviderError extends AppError {
  constructor(message, options = {}) {
    super(message, { statusCode: options.statusCode || 503, code: "PROVIDER_ERROR", ...options });
    this.name = "ProviderError";
  }
}
