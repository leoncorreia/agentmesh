/**
 * Render Key Value: paste the full Internal Redis URL. A bare path or instance
 * name makes ioredis use a Unix socket (ENOENT /agentmesh_redis).
 */
export function getValidatedRedisUrl(): string {
  const url = process.env.REDIS_URL?.trim();
  if (!url || url.startsWith('PLACEHOLDER')) {
    throw new Error('REDIS_URL is not configured');
  }
  if (url.startsWith('/')) {
    throw new Error(
      'REDIS_URL looks like a filesystem path, not a Redis URL. On Render: Key Value instance → copy Internal Redis URL (redis:// or rediss://) into REDIS_URL.',
    );
  }
  if (!/^rediss?:\/\//i.test(url)) {
    throw new Error(
      'REDIS_URL must start with redis:// or rediss://. Use the connection string from your Redis provider.',
    );
  }
  return url;
}
