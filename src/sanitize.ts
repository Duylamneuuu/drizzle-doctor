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

// A malformed escape in one component must not bypass the others.
function decodeCredential(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// Preserve the supplied spelling as well as URL-decoded and normalized forms.
// Percent escapes are case-insensitive; URLSearchParams loses their raw form.
function credentialForms(raw: string, decoded: string): string[] {
  const encoded = encodeURIComponent(decoded);
  return [
    raw,
    raw.replace(/%[\da-f]{2}/gi, (escape) => escape.toUpperCase()),
    raw.replace(/%[\da-f]{2}/gi, (escape) => escape.toLowerCase()),
    decoded,
    encoded,
    encoded.replace(/%[\da-f]{2}/gi, (escape) => escape.toLowerCase()),
  ];
}

/** Match credentials literally, except for case-insensitive percent escapes. */
function credentialPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/%[\da-f]{2}/gi, (escape) => escape.replace(/[a-f]/gi,
      (character) => `[${character.toLowerCase()}${character.toUpperCase()}]`));
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
 * - `password=` / `pass=` fragments, including quoted/escaped values
 *   (keyword/value connection strings, query strings, log quotes)
 *
 * @param message the raw error message to sanitize
 * @param connectionString the connection string whose credentials must not leak
 */
export function redactConnectionString(message: string, connectionString?: string): string {
  if (!connectionString || !message) return redactPasswordFragments(message);

  let redacted = replaceAll(message, connectionString, REDACTED);

  try {
    const url = new URL(connectionString);
    const user = decodeCredential(url.username);
    const password = decodeCredential(url.password);
    const passwordForms = new Set(credentialForms(url.password, password));
    if (password) {
      // Identifiable userinfo is safe to redact even for a short password.
      // Drivers may normalize percent-escape casing in the username too.
      for (const username of new Set(credentialForms(url.username, user))) {
        for (const value of passwordForms) {
          const userinfo = new RegExp(`(${credentialPattern(username)}):${credentialPattern(value)}@`, 'g');
          redacted = redacted.replace(userinfo,
            (_match, matchedUsername: string) => `${matchedUsername}:${REDACTED}@`);
        }
      }
    }
    // Cover every repeated query value, not just the first. Replace longer
    // secrets first so overlapping userinfo/query passwords leave no suffix.
    const secrets = new Set(
      url.search.slice(1).split('&').flatMap((parameter) => {
        const [key, value] = [...new URLSearchParams(parameter)][0] ?? [];
        if ((key !== 'password' && key !== 'pass') || !value) return [];
        return credentialForms(parameter.slice(parameter.indexOf('=') + 1), value);
      }),
    );
    // Preserve short standalone text to avoid corrupting unrelated diagnostics.
    if (password && password.length >= 3) {
      for (const value of passwordForms) secrets.add(value);
    }
    for (const value of [...secrets].sort((a, b) => b.length - a.length)) {
      redacted = replaceAll(redacted, value, REDACTED);
    }
  } catch {
    // Not URL-parseable (keyword/value form, scheme-less, malformed). The
    // whole-string replacement above still covers it; the generic
    // `password=` pass below covers partial fragments.
  }

  return redactPasswordFragments(redacted);
}

function redactPasswordFragments(message: string): string {
  // Generic fallback for partial keyword/value or query-string fragments.
  // Quoted values may contain whitespace/separators; backslashes escape the
  // next character. Also consume unterminated quotes through the end of a
  // diagnostic rather than leaking the remainder of a truncated password.
  return message.replace(
    /\b(password|pass)\s*=\s*(?:'(?:\\[\s\S]|[^'\\])*(?:'|\\?$)|"(?:\\[\s\S]|[^"\\])*(?:"|\\?$)|(?:\\[\s\S]|[^&\s;\\])*\\?)/gi,
    (_match, key: string) => `${key}=${REDACTED}`,
  );
}
