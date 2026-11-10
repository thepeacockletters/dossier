/**
 * The largest export an import takes: the proxy's body limit
 * (proxyClientMaxBodySize in next.config.ts), beyond which bodies are cut
 * off rather than refused.
 */
export const IMPORT_MAX_BYTES = 50 * 1024 * 1024;
export const IMPORT_TOO_BIG = "That file is over 50 MB, more than this server accepts.";
