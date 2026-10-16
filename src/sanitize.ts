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
    const user = url.username ? decodeURIComponent(url.username) : '';
    const password = url.password ? decodeURIComponent(url.password) : '';
    if (password && password.length >= 3) {
      redacted = replaceAll(redacted, `${user}:${password}@`, `${user}:[REDACTED]@`);
      redacted = replaceAll(redacted, `${user}:${encodeURIComponent(password)}@`, `${user}:[REDACTED]@`);
      redacted = replaceAll(redacted, password, REDACTED);
      redacted = replaceAll(redacted, encodeURIComponent(password), REDACTED);
    }
    // pg accepts repeated query parameters and uses the last password value.
    // Cover every supplied value (including encoded diagnostic forms), not
    // just URLSearchParams.get()'s first result. Replace longer secrets first
    // so a shared prefix cannot leave the rest of another password exposed.
    const querySecrets = new Set(
      ['password', 'pass'].flatMap((key) => url.searchParams.getAll(key))
        .filter(Boolean)
        .flatMap((value) => [value, encodeURIComponent(value)]),
    );
    for (const value of [...querySecrets].sort((a, b) => b.length - a.length)) {
      redacted = replaceAll(redacted, value, REDACTED);
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
