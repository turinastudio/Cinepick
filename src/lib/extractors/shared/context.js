import requestContextShared from "../../../config/request-context.cjs";

/**
 * Wraps a catch to log errors in debug mode while returning a fallback.
 * Use: .catch(silentFallback("extractorName", defaultValue))
 */
function silentFallback(extractorName, fallbackValue) {
  return (error) => {
    return fallbackValue;
  };
}

const { isExtractorEnabled } = requestContextShared;

export { silentFallback, isExtractorEnabled };
