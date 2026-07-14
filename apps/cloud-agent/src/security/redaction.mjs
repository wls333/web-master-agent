const patterns = [
  /([A-Z0-9_]*(TOKEN|SECRET|PASSWORD|PASSWD|KEY|COOKIE)[A-Z0-9_]*=)[^\s&]+/gi,
  /(Authorization:\s*Bearer\s+)[A-Za-z0-9._-]+/gi,
  /(Bearer\s+)[A-Za-z0-9._-]+/g,
  /(password=)[^&\s]+/gi,
  /(api[_-]?key=)[^&\s]+/gi,
  /(secret=)[^&\s]+/gi,
  /(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.)[A-Za-z0-9_-]+/g
];

export function redact(value) {
  let output = String(value ?? "");
  for (const pattern of patterns) {
    output = output.replace(pattern, "$1[REDACTED]");
  }
  return output;
}

export function redactObject(input) {
  if (Array.isArray(input)) return input.map(redactObject);
  if (!input || typeof input !== "object") return typeof input === "string" ? redact(input) : input;
  return Object.fromEntries(Object.entries(input).map(([key, value]) => {
    if (/token|secret|password|passwd|apiKey|api_key|cookie/i.test(key)) {
      return [key, "[REDACTED]"];
    }
    return [key, redactObject(value)];
  }));
}
