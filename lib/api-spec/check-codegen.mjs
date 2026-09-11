import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(packageRoot, "..", "..");

const generatedTargets = [
  {
    name: "lib/api-client-react/src/generated",
    path: resolve(repositoryRoot, "lib", "api-client-react", "src", "generated"),
  },
  {
    name: "lib/api-zod/src/generated",
    path: resolve(repositoryRoot, "lib", "api-zod", "src", "generated"),
  },
];

const contractFiles = new Set([
  "lib/api-client-react/src/generated/api.schemas.ts",
  "lib/api-zod/src/generated/api.ts",
  "lib/api-zod/src/generated/types/drawPayoutAttempt.ts",
  "lib/api-zod/src/generated/types/memberHistory.ts",
]);

async function listFiles(directory) {
  if (!existsSync(directory)) {
    return [];
  }

  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

async function snapshotFiles(directory) {
  const files = new Map();
  for (const filePath of await listFiles(directory)) {
    files.set(relative(directory, filePath), await readFile(filePath));
  }
  return files;
}

async function compareGeneratedOutput(beforeDirectory, afterDirectory) {
  const before = await snapshotFiles(beforeDirectory);
  const after = await snapshotFiles(afterDirectory);
  const paths = new Set([...before.keys(), ...after.keys()]);
  const differences = [];

  for (const filePath of [...paths].sort()) {
    const beforeContent = before.get(filePath);
    const afterContent = after.get(filePath);

    if (!beforeContent) {
      differences.push({ filePath, kind: "added" });
    } else if (!afterContent) {
      differences.push({ filePath, kind: "removed" });
    } else if (!beforeContent.equals(afterContent)) {
      differences.push({ filePath, kind: "changed" });
    }
  }

  return differences;
}

async function restoreDirectory(snapshotDirectory, targetDirectory, existed) {
  await rm(targetDirectory, { recursive: true, force: true });
  if (existed) {
    await cp(snapshotDirectory, targetDirectory, { recursive: true });
  }
}

const snapshotRoot = await mkdtemp(join(tmpdir(), "api-codegen-check-"));
const snapshots = [];
let differences = [];
let generationFailed = false;

try {
  for (const target of generatedTargets) {
    const snapshotDirectory = join(snapshotRoot, target.name.replaceAll("/", "__"));
    const existed = existsSync(target.path);
    if (existed) {
      await cp(target.path, snapshotDirectory, { recursive: true });
    }
    snapshots.push({ ...target, snapshotDirectory, existed });
  }

  const result = spawnSync(
    "pnpm",
    ["exec", "orval", "--config", "./orval.config.ts"],
    {
      cwd: packageRoot,
      stdio: "inherit",
      env: process.env,
    },
  );

  if (result.error || result.status !== 0) {
    generationFailed = true;
  } else {
    for (const target of generatedTargets) {
      const snapshot = snapshots.find((item) => item.path === target.path);
      differences.push(
        ...(await compareGeneratedOutput(snapshot.snapshotDirectory, target.path)).map(
          (difference) => ({
            ...difference,
            path: `${target.name}/${difference.filePath}`,
          }),
        ),
      );
    }
  }
} finally {
  for (const snapshot of snapshots.reverse()) {
    await restoreDirectory(
      snapshot.snapshotDirectory,
      snapshot.path,
      snapshot.existed,
    );
  }
  await rm(snapshotRoot, { recursive: true, force: true });
}

if (generationFailed) {
  console.error("API code generation failed; generated output drift could not be checked.");
  process.exitCode = 1;
} else if (differences.length > 0) {
  console.error(
    "Generated API output is out of date with lib/api-spec/openapi.yaml.",
  );
  console.error("Run `pnpm --filter @workspace/api-spec run codegen` and commit the generated files.");
  console.error("Differences:");

  for (const difference of differences) {
    const contractMarker = contractFiles.has(difference.path)
      ? " [payout/member-history contract]"
      : "";
    console.error(`- ${difference.kind}: ${difference.path}${contractMarker}`);
  }

  process.exitCode = 1;
} else {
  console.log(
    "API codegen is up to date, including payout-attempt and member-history response shapes.",
  );
}