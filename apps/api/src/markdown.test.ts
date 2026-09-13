import { loadConfig } from "./config.js";
import { normalizeMarkdown, validateMarkdownFilename } from "./markdown.js";

describe("Markdown evidence boundary", () => {
  const config = loadConfig({ NODE_ENV: "test", APP_MODE: "demo" });

  it("removes active HTML while retaining evidence text", () => {
    expect(normalizeMarkdown("# Note\n<script>alert(1)</script><strong>documented</strong>", config)).toContain("documented");
    expect(normalizeMarkdown("# Note\n<script>alert(1)</script><strong>documented</strong>", config)).not.toContain("alert");
  });

  it("rejects traversal-like filenames", () => {
    expect(() => validateMarkdownFilename("../secret.md")).toThrow("MARKDOWN_FILENAME_INVALID");
    expect(validateMarkdownFilename("audit-note.md")).toBe("audit-note.md");
  });
});
