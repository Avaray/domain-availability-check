#!/usr/bin/env bun
/**
 * Builds two flavors of the CLI into dist/:
 *
 *   dist/dac        standalone executable that embeds the Bun runtime (~80 MB).
 *                   Runs on a machine without Bun.
 *   dist/dac-lite   one minified JS bundle with a `#!/usr/bin/env bun` shebang (tens of KB).
 *                   Needs Bun on PATH, but the same file runs on any OS/CPU that Bun supports.
 *
 * Usage: bun run scripts/build.ts [all|standalone|lite]   (default: all)
 */
import { chmod, readFile, stat, writeFile } from "node:fs/promises";

const ENTRY = "src/cli.ts";
const OUT = "dist";
const MODES = ["all", "standalone", "lite"] as const;
type Mode = (typeof MODES)[number];

const mode = (process.argv[2] ?? "all") as Mode;
if (!MODES.includes(mode)) {
  console.error(`Unknown mode "${mode}". Usage: bun run scripts/build.ts [${MODES.join("|")}]`);
  process.exit(64);
}

/** Runs `bun build` with the same Bun that is executing this script. */
async function bunBuild(args: string[]): Promise<void> {
  const proc = Bun.spawn([process.execPath, "build", ...args, ENTRY], { stdout: "inherit", stderr: "inherit" });
  if ((await proc.exited) !== 0) {
    console.error("Build failed.");
    process.exit(1);
  }
}

async function sizeOf(...paths: string[]): Promise<string> {
  for (const path of paths) {
    try {
      const bytes = (await stat(path)).size;
      return bytes > 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
    } catch {
      /* try the next candidate (Windows adds .exe) */
    }
  }
  return "?";
}

async function buildStandalone(): Promise<void> {
  await bunBuild(["--compile", "--minify", "--outfile", `${OUT}/dac`]);
  console.log(`  ${OUT}/dac       ${await sizeOf(`${OUT}/dac`, `${OUT}/dac.exe`)}  standalone, embeds the Bun runtime`);
}

async function buildLite(): Promise<void> {
  const file = `${OUT}/dac-lite`;
  await bunBuild(["--target=bun", "--minify", "--outfile", file]);

  // Make sure the bundle can be run directly (./dac-lite), whatever the bundler did with the shebang.
  const code = await readFile(file, "utf8");
  if (!code.startsWith("#!")) await writeFile(file, `#!/usr/bin/env bun\n${code}`);
  await chmod(file, 0o755).catch(() => {}); // no-op on Windows

  console.log(`  ${file}  ${await sizeOf(file)}  lite, needs Bun on PATH`);
}

console.log("Building into dist/ ...");
if (mode === "all" || mode === "standalone") await buildStandalone();
if (mode === "all" || mode === "lite") await buildLite();
