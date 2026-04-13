import { json } from "../../lib/http.js";
import { AppError } from "../errors.js";

/**
 * Centralized error handling middleware.
 * Catches all unhandled errors and formats consistent responses.
 *
 * @param {Error} error
 * @param {import("http").ServerResponse} res
 * @param {import("http").IncomingMessage} req
 */
export function errorHandler(error, res, req) {
  const isOperational = error instanceof AppError ? error.isOperational : false;
  const statusCode = error instanceof AppError ? error.statusCode : 500;
  const code = error instanceof AppError ? error.code : "INTERNAL_ERROR";

  // Log full details for debugging
  const logContext = {
    method: req?.method || "UNKNOWN",
    url: req?.url || "UNKNOWN",
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    cause: error?.cause ? String(error.cause) : undefined,
    code,
    isOperational
  };

  if (statusCode >= 500) {
    console.error("Unhandled server error:", JSON.stringify(logContext, null, 2));
    if (error.stack) {
      console.error(error.stack);
    }
  } else {
    console.warn(
      `[warn] ${logContext.error}`,
      JSON.stringify(logContext.context || {}, null, 2)
    );
  }

  // Client response: never leak internal details on 5xx
  const response = {
    error: statusCode >= 500 ? "Internal server error" : (error.message || "Error"),
    code
  };

  if (statusCode < 500 && error instanceof AppError && error.details) {
    response.details = error.details;
  }

  json(res, statusCode, response);
}

/**
 * Creates an error handler bound to a specific response.
 * @param {import("http").ServerResponse} res
 * @returns {(error: Error) => void}
 */
export function createErrorHandler(res) {
  return (err) => {
    errorHandler(null, res, () => {}, err);
  };
}

/**
 * Wraps an async route handler with error catching.
 * @param {Function} handler - The async route handler
 * @returns {Function} - Wrapped handler that catches errors
 */
export function asyncHandler(handler) {
  return async (req, res, ...args) => {
    try {
      return await handler(req, res, ...args);
    } catch (error) {
      errorHandler(error, res, req);
    }
  };
}
