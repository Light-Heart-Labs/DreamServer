const SECRET_PATTERNS = [
  /(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*['"]?[^'"\s]+/gi,
  /(sk-[A-Za-z0-9_-]{12,})/g
];

function redactSecrets(line = "") {
  let text = String(line || "");
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, (match, key) => String(match).startsWith("sk-") ? "sk-***" : `${key || "secret"}=***`);
  }
  return text;
}

function parseProgressLine(line = "") {
  const text = redactSecrets(line).trim();
  const percentMatch = text.match(/(\d{1,3})\s*%/);
  const phaseMatch = text.match(/phase\s+(\d+)|\[(?:phase|step)\s*(\d+)\]/i);
  const level = /\b(error|failed|fatal)\b/i.test(text) ? "error" : (/\b(warn|warning|aten[cç][aã]o)\b/i.test(text) ? "warning" : "info");
  return { raw: text, level, percent: percentMatch ? Math.max(0, Math.min(100, Number(percentMatch[1]))) : null, phase: phaseMatch ? Number(phaseMatch[1] || phaseMatch[2]) : null, at: new Date().toISOString() };
}

module.exports = { redactSecrets, parseProgressLine };
