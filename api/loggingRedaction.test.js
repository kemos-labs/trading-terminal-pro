import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import pino from 'pino';

const REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-api-key"]',
  'req.headers["x-rapidapi-key"]',
  'req.headers["stripe-signature"]',
  'req.body.password',
  'req.body.token',
  'req.body.newPassword',
  'res.headers["set-cookie"]',
  '*.password',
  '*.token',
  '*.secret',
  'password',
  'token',
  'secret',
];

function captureLogger() {
  const lines = [];
  const stream = {
    write(chunk) {
      lines.push(String(chunk));
    },
  };
  const logger = pino({ level: 'info', redact: { paths: REDACT_PATHS, censor: '***' } }, stream);
  return { logger, lines };
}

describe('structured logging redaction', () => {
  it('redacts cookie, authorization and credential fields via pino redact', () => {
    const { logger, lines } = captureLogger();
    logger.info(
      {
        req: {
          headers: {
            cookie: 'vt_session=secret123',
            authorization: 'Bearer sk_live_abc',
            'x-api-key': 'shmk_live_deadbeef',
            'x-rapidapi-key': 'rapid-secret',
            'stripe-signature': 'whsec_abc',
          },
          body: { password: 'hunter2', token: 'tok_123', newPassword: 'newhunter' },
        },
        password: 'top-level-pw',
        token: 'top-level-token',
      },
      'test log',
    );
    const out = lines.join('\n');
    expect(out).not.toContain('secret123');
    expect(out).not.toContain('hunter2');
    expect(out).not.toContain('tok_123');
    expect(out).not.toContain('shmk_live_deadbeef');
    expect(out).toContain('***');
  });

  it('Fastify logger with same redact does not leak body secrets on request log', async () => {
    const lines = [];
    const stream = { write: (c) => lines.push(String(c)) };
    const app = Fastify({
      logger: {
        level: 'info',
        stream,
        redact: { paths: REDACT_PATHS, censor: '***' },
      },
    });
    app.post('/api/auth/login', async (req) => {
      // Real server logs only password/token fields, never raw headers object
      req.log.info({ body: req.body, password: req.body.password }, 'login attempt');
      return { ok: true };
    });
    await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'a@b.c', password: 'supersecret' },
    });
    const out = lines.join('\n');
    expect(out).not.toContain('supersecret');
    expect(out).toContain('***');
    await app.close();
  });
});
