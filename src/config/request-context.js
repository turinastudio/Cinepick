import requestContextShared from "./request-context.cjs";

export const {
  getRequestBasePathPrefix,
  getRequestConfig,
  getRequestConfigToken,
  getSelectionMaxResults,
  getSelectionMode,
  isEngineEnabled,
  isExtractorEnabled,
  isInternalOnlyEnabled,
  isProviderEnabled,
  runWithRequestConfig,
  shouldShowSupportStream
} = requestContextShared;
