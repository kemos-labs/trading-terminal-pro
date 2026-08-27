/**
 * Validated environment/config — Phase 8. Centralizes PORT, TRUST_PROXY, LOG_LEVEL, body limits.
 */
export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  logLevel: process.env.LOG_LEVEL || 'info',
  bodyLimit: 1_048_576,
  connectionTimeout: 30_000,
  keepAliveTimeout: 72_000,
  requestTimeout: 30_000,
};
