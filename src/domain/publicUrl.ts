function isBlockedIpv4(hostname: string): boolean {
  const parts = hostname.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;

  const octets = parts.map(Number);
  if (octets.some((octet) => octet > 255)) return true;

  const [a, b, c] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function parseIpv6Hextets(hostname: string): number[] | null {
  if (!hostname.includes(':')) return null;

  const normalized = hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  const halves = normalized.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if (
    left.some((part) => !/^[0-9a-f]{1,4}$/.test(part)) ||
    right.some((part) => !/^[0-9a-f]{1,4}$/.test(part))
  ) return null;
  const zeroCount = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (zeroCount < 0 || (halves.length === 1 && left.length !== 8)) return null;
  const hextets = [
    ...left.map((part) => Number.parseInt(part, 16)),
    ...Array.from({ length: zeroCount }, () => 0),
    ...right.map((part) => Number.parseInt(part, 16))
  ];
  return hextets.length === 8 ? hextets : null;
}

function isBlockedIpv6(hostname: string): boolean {
  const hextets = parseIpv6Hextets(hostname);
  if (!hextets) return hostname.includes(':');

  const [first = 0, second = 0, third = 0, fourth = 0] = hextets;
  return (
    first === 0 ||
    (first === 0x64 && second === 0xff9b && third === 1) ||
    (first === 0x100 && second === 0 && third === 0 && fourth === 0) ||
    (first === 0x2001 && second === 0x2 && third === 0) ||
    (first === 0x2001 && (second & 0xfff0) === 0x10) ||
    (first === 0x2001 && (second & 0xfff0) === 0x20) ||
    (first === 0x2001 && (second & 0xfff0) === 0x30) ||
    (first === 0x2001 && second === 0x100 && third === 0 && fourth === 0) ||
    (first === 0x2001 && second === 0xdb8) ||
    (first === 0x3fff && (second & 0xf000) === 0) ||
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xffc0) === 0xfec0 ||
    (first & 0xff00) === 0xff00
  );
}

export function isSafePublicHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
    return (
      url.protocol === 'https:' &&
      url.username === '' &&
      url.password === '' &&
      hostname !== 'localhost' &&
      !hostname.endsWith('.localhost') &&
      !hostname.endsWith('.local') &&
      !hostname.endsWith('.internal') &&
      !isBlockedIpv4(hostname) &&
      !isBlockedIpv6(hostname)
    );
  } catch {
    return false;
  }
}
