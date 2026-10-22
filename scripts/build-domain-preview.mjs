import { mkdir, readdir, readFile, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const target = path.join(root, "work", "domain-preview");
async function copyDirectory(relative = "") {
  const source = path.join(root, "docs", relative);
  const destination = path.join(target, relative);
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.name.endsWith(".md")) continue;
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) { await copyDirectory(child); continue; }
    if (/\.(html|js|css|json|xml|txt)$/.test(entry.name)) {
      const text = await readFile(path.join(source, entry.name), "utf8");
      await writeFile(path.join(destination, entry.name), text
        .replaceAll("https://andriandev0.github.io/simka-store/", "https://simki.cc/")
        .replaceAll("/simka-store/", "/"));
    } else await copyFile(path.join(source, entry.name), path.join(destination, entry.name));
  }
}
await copyDirectory();
console.log(`Domain preview prepared at ${target}; orders remain disabled.`);
