// Redacts credential-bearing connection strings from error messages before
// they reach stderr, reports, or JSON output.
//
// Product invariant D11 (docs/DECISIONS.md): database URLs and passwords
// accepted through the CLI or DATABASE_URL must never be logged. pg and other
// low-level drivers can embed the connection string in thrown errors; this
// module guarantees that whatever the driver throws, the user-visible message
// no longer contains the secret.

const REDACTED = '[REDACTED]';

function replaceAll(input: string, needle: string, replacement: string): string {
  return input.split(needle).join(replacement);
}

// Malformed escape sequences must not bypass redaction of other components.
function decodeCredential(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Removes connection-string credential material from `message`.
 *
 * Redacts:
 * - the full connection string wherever it appears verbatim
 * - the `user:password@` userinfo prefix of URL-form strings (raw and
 *   percent-encoded password forms)
 * - the bare password value (guarded against trivial single/two-character
 *   passwords to avoid mangling unrelated text)
 * - `password=` / `pass=` fragments (keyword/value connection strings, query
 *   strings, log quotes)
 *
 * @param message the raw error message to sanitize
 * @param connectionString the connection string whose credentials must not leak
 */
export function redactConnectionString(message: string, connectionString?: string): string {
  if (!connectionString || !message) return message;

  let redacted = replaceAll(message, connectionString, REDACTED);

  try {
    const url = new URL(connectionString);
    const user = decodeCredential(url.username);
    const password = decodeCredential(url.password);
    if (password) {
      const users = new Set([url.username, user]);
      const passwords = new Set([url.password, password, encodeURIComponent(password)]);
      // Userinfo is credential-specific context: redact even a short password.
      for (const username of users) {
        for (const value of passwords) {
          redacted = replaceAll(redacted, `${username}:${value}@`, `${username}:${REDACTED}@`);
        }
      }
      // Keep short standalone values intact to avoid corrupting diagnostics.
      if (password.length >= 3) {
        for (const value of passwords) {
          redacted = replaceAll(redacted, value, REDACTED);
        }
      }
    }
    for (const key of ['password', 'pass']) {
      const value = url.searchParams.get(key);
      if (value) {
        redacted = replaceAll(redacted, `${key}=${value}`, `${key}=${REDACTED}`);
        redacted = replaceAll(redacted, value, REDACTED);
      }
    }
  } catch {
    // Not URL-parseable (keyword/value form, scheme-less, malformed). The
    // whole-string replacement above still covers it; the generic
    // `password=` pass below covers partial fragments.
  }

  // Generic fallback for `password=<value>` / `pass=<value>` fragments where
  // the value runs until whitespace, `&`, or `;`.
  redacted = redacted.replace(/\b(password|pass)=([^&\s;]*)/gi, (_match, key: string) => `${key}=${REDACTED}`);

  return redacted;
}
