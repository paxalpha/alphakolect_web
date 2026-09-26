import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/platform/config.js';

const valid = { DATABASE_URL: 'postgresql://user:s3cret-value@127.0.0.1:5436/alphakolect' };

describe('loadConfig', () => {
  it('applies safe defaults for non-secret settings', () => {
    const config = loadConfig(valid);
    expect(config).toMatchObject({ nodeEnv: 'development', port: 4000, logLevel: 'info' });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('refuses to load without DATABASE_URL', () => {
    expect(() => loadConfig({})).toThrowError(ConfigError);
    try {
      loadConfig({});
    } catch (err) {
      expect((err as ConfigError).problems).toEqual(['DATABASE_URL is required']);
    }
  });

  it('rejects a non-postgres DATABASE_URL without echoing the value', () => {
    const secretish = 'mysql://root:do-not-print-me@db/app';
    try {
      loadConfig({ DATABASE_URL: secretish });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as Error).message).toContain('DATABASE_URL');
      expect((err as Error).message).not.toContain('do-not-print-me');
    }
  });

  it('reports every invalid variable at once', () => {
    try {
      loadConfig({ PORT: '70000', LOG_LEVEL: 'loud', NODE_ENV: 'staging' });
      expect.unreachable();
    } catch (err) {
      const names = (err as ConfigError).problems.map((p) => p.split(' ')[0]).sort();
      expect(names).toEqual(['DATABASE_URL', 'LOG_LEVEL', 'NODE_ENV', 'PORT']);
    }
  });
});
