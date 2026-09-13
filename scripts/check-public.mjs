import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import process from "node:process";

const root = process.cwd();
const ignored = new Set([".git", "node_modules", "dist", "coverage", "playwright-report", "test-results"]);
const files = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const full = join(directory, entry.name);
    if (entry.isDirectory()) await walk(full);
    else files.push(full);
  }
}
await walk(root);

const patterns = [
  { name: "private key", regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i },
  { name: "database credential", regex: /postgres(?:ql)?:\/\/(?!\$\{)[^\s"']+:[^\s"'@]+@/i },
  { name: "bearer credential", regex: /Bearer\s+[A-Za-z0-9._-]{24,}/ },
  { name: "numeric patient identifier", regex: /\b(?:HN|AN|VN)\s*[:#-]?\s*\d{6,}\b/i },
  { name: "SQL dump", regex: /^COPY\s+.+\s+FROM\s+stdin;/im },
  { name: "secret assignment", regex: /(?:API_KEY|TOKEN|PASSWORD|SESSION_SECRET|CASE_REF_SECRET|DATA_ENCRYPTION_KEY)\s*[=:]\s*["'](?!replace-with|development-only|\$\{)[^"']{16,}["']/i },
];

const violations = [];
for (const file of files) {
  if (/\.(png|jpg|jpeg|gif|woff2|ico|lock)$/i.test(file)) continue;
  let text;
  try { text = await readFile(file, "utf8"); } catch { continue; }
  for (const pattern of patterns) if (pattern.regex.test(text)) violations.push(`${pattern.name}: ${relative(root, file)}`);
}

const referencePath = "C:/Users/KTLho/.codex/attachments/1d17e3c4-b101-4646-a096-572f61508181/pasted-text.txt";
try {
  const reference = await readFile(referencePath, "utf8");
  const identifiers = [
    ...[...reference.matchAll(/\b(?:HN|AN|VN)\s*[:#-]?\s*(\d{6,})\b/gi)].map((match) => match[1]),
    ...[...reference.matchAll(/'([0-9]{6,})'/g)].map((match) => match[1]),
  ].filter(Boolean);
  for (const identifier of new Set(identifiers)) {
    for (const file of files) {
      if (/\.lock$/i.test(file)) continue;
      const text = await readFile(file, "utf8").catch(() => "");
      if (text.includes(identifier)) violations.push(`identifier copied from pasted reference: ${relative(root, file)}`);
    }
  }
} catch {
  // The attachment is intentionally not part of the repository or CI workspace.
}

if (violations.length) {
  process.stderr.write(`Public safety scan failed:\n${[...new Set(violations)].join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`Public safety scan passed for ${files.length} files.\n`);
