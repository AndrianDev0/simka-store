import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createEncryptedDatabaseBackup } from "../lib/database-backup.ts";

const output = process.argv[2] || `simka-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json.enc`;
const backup = await createEncryptedDatabaseBackup();
await mkdir(dirname(output), { recursive: true });
await writeFile(output, backup.data, { flag: "wx", mode: 0o600 });
console.log(`Зашифрованная копия записана в ${output}; таблиц: ${backup.tableCount}; исходный размер: ${backup.byteCount} байт.`);
