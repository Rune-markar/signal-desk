export function buildContentSecurityPolicy(formActionRedirectUri?: string): string {
  const formActionSources = ["'self'"];
  if (formActionRedirectUri) {
    const redirect = new URL(formActionRedirectUri);
    if (redirect.protocol === 'http:' || redirect.protocol === 'https:') {
      formActionSources.push(redirect.origin);
    }
  }

  return [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    `form-action ${formActionSources.join(' ')}`,
    "base-uri 'none'",
    "frame-ancestors 'none'"
  ].join('; ');
}
