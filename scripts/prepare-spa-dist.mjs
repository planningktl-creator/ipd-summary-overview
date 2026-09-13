import { cp, copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { stdout } from "node:process";

const rootDist = resolve("dist");
const webDist = resolve("dist/web");

await mkdir(rootDist, { recursive: true });

for (const entry of await readdir(webDist, { withFileTypes: true })) {
  const source = join(webDist, entry.name);
  const destination = join(rootDist, entry.name);

  if (entry.isDirectory()) {
    await rm(destination, { force: true, recursive: true });
    await cp(source, destination, { recursive: true });
  } else {
    await copyFile(source, destination);
  }
}

stdout.write(
  `Prepared hosted SPA artifact at ${join(rootDist, "index.html")} (Docker artifact remains ${webDist}).\n`,
);
