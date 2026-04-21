/**
 * Input validation for Stremio addon endpoints.
 *
 * Validates request boundaries to fail fast with clear errors.
 * Based on nodejs-best-practices principle #6: Validate at boundaries.
 */

import { ValidationError, BadRequestError } from "../app/errors.js";

// ── Constants ──────────────────────────────────────────────────
const VALID_STREMIO_TYPES = new Set(["movie", "series", "anime", "tv"]);

/**
 * Validates a Stremio content type.
 * @param {string} type - The type to validate
 * @returns {string} - The validated type (normalized)
 * @throws {ValidationError}
 */
export function validateStremioType(type) {
  if (!type || typeof type !== "string") {
    throw new ValidationError("Missing content type", { field: "type" });
  }

  const normalized = type.toLowerCase().trim();

  if (!VALID_STREMIO_TYPES.has(normalized)) {
    throw new ValidationError(
      `Invalid content type "${type}". Must be one of: ${Array.from(VALID_STREMIO_TYPES).join(", ")}`,
      { field: "type", value: type, validValues: Array.from(VALID_STREMIO_TYPES) }
    );
  }

  return normalized;
}

/**
 * Validates a Stremio content ID.
 * @param {string} id - The ID to validate
 * @param {object} options
 * @param {number} [options.maxLength=200] - Max ID length
 * @returns {string} - The validated ID
 * @throws {ValidationError}
 */
export function validateStremioId(id, options = {}) {
  const { maxLength = 200 } = options;

  if (!id || typeof id !== "string") {
    throw new ValidationError("Missing content ID", { field: "id" });
  }

  const trimmed = id.trim();

  if (trimmed.length === 0) {
    throw new ValidationError("Content ID cannot be empty", { field: "id" });
  }

  if (trimmed.length > maxLength) {
    throw new ValidationError(
      `Content ID too long (max ${maxLength} characters)`,
      { field: "id", maxLength, actualLength: trimmed.length }
    );
  }

  // Basic safety: no path traversal or injection
  if (trimmed.includes("..") || trimmed.includes("\\") || trimmed.includes("\0")) {
    throw new BadRequestError("Invalid content ID format");
  }

  return trimmed;
}

/**
 * Validates stream request parameters.
 * @param {string} type
 * @param {string} id
 * @returns {{ type: string, id: string }}
 * @throws {ValidationError}
 */
export function validateStreamRequest(type, id) {
  return {
    type: validateStremioType(type),
    id: validateStremioId(id)
  };
}

/**
 * Validates a provider ID.
 * @param {string} providerId
 * @returns {string}
 * @throws {ValidationError}
 */
export function validateProviderId(providerId) {
  if (!providerId || typeof providerId !== "string") {
    throw new ValidationError("Missing provider ID", { field: "providerId" });
  }

  const trimmed = providerId.trim().toLowerCase();

  if (trimmed.length === 0) {
    throw new ValidationError("Provider ID cannot be empty", { field: "providerId" });
  }

  // Alphanumeric + hyphens only
  if (!/^[a-z0-9-]+$/.test(trimmed)) {
    throw new ValidationError(
      "Invalid provider ID format. Only alphanumeric characters and hyphens are allowed",
      { field: "providerId", value: providerId }
    );
  }

  return trimmed;
}

/**
 * Validates search query parameters.
 * @param {string} query
 * @param {object} options
 * @param {number} [options.maxLength=500]
 * @returns {string}
 * @throws {ValidationError}
 */
export function validateSearchQuery(query, options = {}) {
  const { maxLength = 500 } = options;

  if (!query || typeof query !== "string") {
    throw new ValidationError("Missing search query", { field: "query" });
  }

  const trimmed = query.trim();

  if (trimmed.length === 0) {
    throw new ValidationError("Search query cannot be empty", { field: "query" });
  }

  if (trimmed.length > maxLength) {
    throw new ValidationError(
      `Search query too long (max ${maxLength} characters)`,
      { field: "query", maxLength, actualLength: trimmed.length }
    );
  }

  return trimmed;
}

/**
 * Validates pagination skip parameter.
 * @param {string|number} skip
 * @param {object} options
 * @param {number} [options.maxSkip=10000]
 * @returns {number}
 * @throws {ValidationError}
 */
export function validateSkip(skip, options = {}) {
  const { maxSkip = 10000 } = options;

  if (skip === undefined || skip === null || skip === "") {
    return 0;
  }

  const parsed = Number.parseInt(skip, 10);

  if (Number.isNaN(parsed) || parsed < 0) {
    throw new ValidationError(
      "Invalid skip parameter. Must be a non-negative integer",
      { field: "skip", value: skip }
    );
  }

  if (parsed > maxSkip) {
    throw new ValidationError(
      `Skip value too large (max ${maxSkip})`,
      { field: "skip", value: parsed, maxSkip }
    );
  }

  return parsed;
}
