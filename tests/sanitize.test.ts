// P0.7 — executable evidence for invariant D11 (no credential logging):
// whatever a driver throws, the connection string and its password must not
// survive into the user-visible error message.
import { describe, expect, it } from 'vitest';

import { redactConnectionString } from '../src/sanitize.js';

const URL = 'postgres://doctor:s3cr3t-pass@db.example.com:5432/app';

describe('redactConnectionString', () => {
  it('redacts the full connection string when a driver embeds it verbatim', () => {
    const message = `connect ECONNREFUSED while connecting to ${URL} (retrying)`;
    expect(redactConnectionString(message, URL)).toBe(
      'connect ECONNREFUSED while connecting to [REDACTED] (retrying)',
    );
  });

  it('redacts the URL prefix even when a message appends to it', () => {
    const message = 'failed to open postgres://doctor:s3cr3t-pass@db.example.com:5432/app?retry: auth refused';
    // The full connection string is a prefix of the sketch; the whole match
    // is redacted, which also removes the userinfo credentials.
    expect(redactConnectionString(message, URL)).toBe('failed to open [REDACTED]?retry: auth refused');
    expect(redactConnectionString(message, URL)).not.toContain('s3cr3t-pass');
  });

  it('redacts the user:password@ userinfo prefix when the surrounding text differs', () => {
    const message = 'error: login for doctor:s3cr3t-pass@mirror rejected by pool';
    expect(redactConnectionString(message, URL)).toBe('error: login for doctor:[REDACTED]@mirror rejected by pool');
    expect(redactConnectionString(message, URL)).not.toContain('s3cr3t-pass');
  });

  it('redacts the bare password value', () => {
    const message = `password authentication failed for credential "s3cr3t-pass"`;
    expect(redactConnectionString(message, URL)).not.toContain('s3cr3t-pass');
  });

  it('redacts percent-encoded password forms', () => {
    const encodedUrl = 'postgres://doctor:p%40ss%3Aw0rd@db.example.com:5432/app';
    const message = `WARNING: login failed using ${encodedUrl}`;
    expect(redactConnectionString(message, encodedUrl)).not.toContain('p%40ss%3Aw0rd');
  });

  it('redacts password= values in keyword/value and query-string fragments', () => {
    const kv = 'host=db.example.com port=5432 user=doctor password=s3cr3t-pass dbname=app';
    const redacted = redactConnectionString(kv, URL);
    expect(redacted).toContain('host=db.example.com port=5432 user=doctor password=[REDACTED] dbname=app');
    expect(redacted).not.toContain('s3cr3t-pass');

    const query = '?user=doctor&password=s3cr3t-pass&sslmode=require';
    expect(redactConnectionString(query, URL)).toBe('?user=doctor&password=[REDACTED]&sslmode=require');
  });

  it('leaves messages without credential material unchanged', () => {
    const message = 'connect ECONNREFUSED 127.0.0.1:5432, please check the database host';
    expect(redactConnectionString(message, URL)).toBe(message);
  });

  it('handles a password-free connection string', () => {
    const message = 'connect ECONNREFUSED db.example.com:5432';
    expect(redactConnectionString(message, 'postgres://doctor@db.example.com:5432/app')).toBe(message);
  });

  it('does not mangle unrelated short values when the password is trivial', () => {
    const short = 'postgres://doctor:ab@db.example.com:5432/app';
    const message = 'failed connection to a backend labeled "ab"';
    const redacted = redactConnectionString(message, short);
    // The userinfo prefix is still redacted; standalone short values are left
    // alone to avoid mangling unrelated text.
    expect(redacted).not.toContain('doctor:ab@');
    expect(redacted).toContain('backend labeled "ab"');
  });

  it('is a no-op without a connection string', () => {
    const message = 'some unrelated error';
    expect(redactConnectionString(message)).toBe(message);
    expect(redactConnectionString(message, undefined)).toBe(message);
  });

  it.each(['a', 'ab', '@'])('redacts short password %s in userinfo without altering unrelated text', (password) => {
    const encoded = encodeURIComponent(password);
    const connection = `postgres://doctor:${encoded}@db.example.com/app`;
    for (const value of new Set([password, encoded])) {
      const message = `login doctor:${value}@mirror rejected; backend labeled "${password}"`;
      expect(redactConnectionString(message, connection)).toBe(
        `login doctor:[REDACTED]@mirror rejected; backend labeled "${password}"`,
      );
    }
  });

  it.each([
    ['doc%ZZ', 'long-secret'],
    ['doctor', 'bad%ZZ'],
    ['doctor', '%FF'],
  ])('redacts userinfo with malformed encoding (%s, %s)', (user, password) => {
    const connection = `postgres://${user}:${password}@db.example.com/app`;
    expect(redactConnectionString(`login ${user}:${password}@mirror rejected`, connection)).toBe(
      `login ${user}:[REDACTED]@mirror rejected`,
    );
  });

  it('redacts encoded and decoded usernames independently of the password encoding', () => {
    const connection = 'postgres://doc%40team:p%40ss@db.example.com/app';
    for (const user of ['doc%40team', 'doc@team']) {
      for (const password of ['p%40ss', 'p@ss']) {
        expect(redactConnectionString(`login ${user}:${password}@mirror rejected`, connection)).toBe(
          `login ${user}:[REDACTED]@mirror rejected`,
        );
      }
    }
  });

  it.each([
    ["password='first second' host=db", 'password=[REDACTED] host=db'],
    ['pass="first second"; retry=no', 'pass=[REDACTED]; retry=no'],
    ["PASSWORD = 'first second' host=db", 'PASSWORD=[REDACTED] host=db'],
    [String.raw`password='first\' second\\ third' host=db`, 'password=[REDACTED] host=db'],
    [String.raw`password=first\ second host=db`, 'password=[REDACTED] host=db'],
    ["password='first & second; third' host=db", 'password=[REDACTED] host=db'],
    ["password='first second", 'password=[REDACTED]'],
    ['pass="first second' + '\\', 'pass=[REDACTED]'],
    ["password='' host=db", 'password=[REDACTED] host=db'],
    ['?password=first&sslmode=require', '?password=[REDACTED]&sslmode=require'],
    ["password='first second' pass=third", 'password=[REDACTED] pass=[REDACTED]'],
  ])('redacts complete credential fragments: %s', (fragment, expected) => {
    // The original connection string differs from the partial diagnostic, so
    // full-string replacement cannot hide an incomplete fragment redaction.
    expect(redactConnectionString(`authentication failed: ${fragment}`, 'host=db password=example')).toBe(
      `authentication failed: ${expected}`,
    );
  });

  it.each(['password', 'pass'])('redacts every repeated %s query value, decoded and encoded', (key) => {
    const first = 'first-query-secret';
    const last = 'last query:secret';
    const encoded = encodeURIComponent(last);
    const connectionString = `postgres://doctor@db.example.com/app?${key}=${first}&${key}=${encoded}`;
    // pg-connection-string uses the last repeated password, not the first.
    // A driver diagnostic need not retain the query key or the entire URL.
    const message = `credentials "${first}", "${last}", "${encoded}" rejected`;
    expect(redactConnectionString(message, connectionString)).toBe(
      'credentials "[REDACTED]", "[REDACTED]", "[REDACTED]" rejected',
    );
  });

  it('redacts overlapping query secrets completely, regardless of key or parameter order', () => {
    const connectionString = 'postgres://doctor@db.example.com/app?password=shared-secret&pass=shared-secret-suffix&password=shared-secret-longer';
    expect(redactConnectionString('shared-secret-suffix / shared-secret-longer', connectionString)).toBe(
      '[REDACTED] / [REDACTED]',
    );
  });

  it('does not leave query-secret suffixes after redacting a shorter userinfo password', () => {
    const connectionString = 'postgres://doctor:shared-secret@db.example.com/app?password=shared-secret-suffix&pass=shared-secret-longer';
    expect(redactConnectionString('shared-secret-suffix / shared-secret-longer', connectionString)).toBe(
      '[REDACTED] / [REDACTED]',
    );
  });

  it.each([
    ['doctor', 'x', 'doctor', 'x'],
    ['doctor', 'ab', 'doctor', 'ab'],
    ['', 'ab', '', 'ab'],
    ['doc%40tor', 'ab', 'doc%40tor', 'ab'],
    ['doc%40tor', 'ab', 'doc@tor', 'ab'],
    ['doctor', '%2a', 'doctor', '%2a'],
    ['doctor', '%2a', 'doctor', '%2A'],
    ['doctor', '%2a', 'doctor', '*'],
    ['doc%40tor', '%C3%A9', 'doc%40tor', 'é'],
  ])('redacts short userinfo credentials (%s:%s) rendered as %s:%s', (user, password, renderedUser, renderedPassword) => {
    const connectionString = `postgres://${user}:${password}@db.example.com/app?sslmode=require`;
    // A driver may omit the query/path or decode userinfo when reporting an
    // error, so replacing only the full connection string is insufficient.
    const message = `login failed at postgres://${renderedUser}:${renderedPassword}@mirror; backend labeled "ab"`;
    expect(redactConnectionString(message, connectionString)).toBe(
      `login failed at postgres://${renderedUser}:[REDACTED]@mirror; backend labeled "ab"`,
    );
  });

  it('redacts credential fragments without a connection string', () => {
    expect(redactConnectionString("login rejected: password='first second' host=db")).toBe(
      'login rejected: password=[REDACTED] host=db',
    );
  });
});
