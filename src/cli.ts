#!/usr/bin/env node
import { Console, Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { realpathSync } from "node:fs";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  buildD1Artifact,
  decodeD1Artifact,
  renderD1ArtifactFile,
  stringifyD1Artifact,
  validateD1Artifact,
  type D1Artifact,
} from "./D1Artifact.ts";
import { InvalidDefinition } from "./Error.ts";
import { buildManifest, decodeManifest, validateManifest, type Manifest } from "./Manifest.ts";
import type { Capsule } from "./Capsule.ts";
import { VERSION } from "./index.ts";

const jsonFlag = Flag.boolean("json").pipe(
  Flag.withDefault(false),
  Flag.withDescription("Emit one JSON result suitable for CI and agents"),
);

const moduleFlag = Flag.string("module").pipe(
  Flag.withDescription("Path to the authored capsule module (required)"),
);

const exportFlag = Flag.string("export").pipe(
  Flag.withDescription("Explicit named export containing one capsule or a capsule array"),
);

const outputFlag = Flag.string("output").pipe(
  Flag.withDescription("Manifest file or D1 artifact directory to write"),
);

const manifestFlag = Flag.string("manifest").pipe(
  Flag.withDescription("Path to the expected manifest JSON"),
);

const artifactFlag = Flag.string("artifact").pipe(
  Flag.withDescription("Path to an artifact JSON file or generated artifact directory"),
);

type AnyCapsule = Capsule<never, unknown, unknown>;

const isCapsule = (value: unknown): value is AnyCapsule => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<AnyCapsule>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.namespace === "string" &&
    Array.isArray(candidate.migrations) &&
    "layer" in candidate
  );
};

const operationError = (subject: string, cause: unknown): InvalidDefinition =>
  new InvalidDefinition({ subject, reason: String(cause) });

const loadCapsules = (
  modulePath: string,
  exportName: string,
): Effect.Effect<ReadonlyArray<AnyCapsule>, InvalidDefinition> =>
  Effect.tryPromise({
    try: async () => {
      const absolutePath = resolve(modulePath);
      const moduleNamespace = (await import(pathToFileURL(absolutePath).href)) as Record<
        string,
        unknown
      >;
      if (!(exportName in moduleNamespace)) {
        throw new Error(`module has no export named ${JSON.stringify(exportName)}`);
      }
      let value = moduleNamespace[exportName];
      if (Effect.isEffect(value)) {
        value = await Effect.runPromise(value as Effect.Effect<unknown, unknown, never>);
      }
      const values = Array.isArray(value) ? value : [value];
      if (values.length === 0 || values.some((candidate) => !isCapsule(candidate))) {
        throw new Error(
          `export ${JSON.stringify(exportName)} must resolve to a Capsule or non-empty Capsule array`,
        );
      }
      return values as ReadonlyArray<AnyCapsule>;
    },
    catch: (cause) => operationError("capsule module", cause),
  });

const readText = (path: string, subject: string): Effect.Effect<string, InvalidDefinition> =>
  Effect.tryPromise({
    try: () => readFile(resolve(path), "utf8"),
    catch: (cause) => operationError(subject, cause),
  });

const readJson = <A>(path: string, subject: string): Effect.Effect<A, InvalidDefinition> =>
  readText(path, subject).pipe(
    Effect.flatMap((text) =>
      Effect.try({
        try: () => JSON.parse(text) as A,
        catch: (cause) => operationError(subject, cause),
      }),
    ),
  );

const writeText = (
  path: string,
  contents: string,
  subject: string,
): Effect.Effect<void, InvalidDefinition> =>
  Effect.tryPromise({
    try: async () => {
      const absolutePath = resolve(path);
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, contents, "utf8");
    },
    catch: (cause) => operationError(subject, cause),
  });

const writeManifest = (
  capsules: ReadonlyArray<AnyCapsule>,
  output: string,
): Effect.Effect<Manifest, unknown> =>
  Effect.gen(function* () {
    const manifest = yield* buildManifest({ capsules });
    yield* writeText(output, `${JSON.stringify(manifest, null, 2)}\n`, "manifest output");
    return manifest;
  });

const buildFromInput = (modulePath: string, exportName: string) =>
  loadCapsules(modulePath, exportName).pipe(
    Effect.flatMap((capsules) => buildManifest({ capsules })),
  );

const capsuleCount = (manifest: Manifest): number => manifest.capsules.length;

const migrationCount = (manifest: Manifest): number =>
  manifest.capsules.reduce((count, capsule) => count + capsule.migrations.length, 0);

const errorRecord = (error: unknown): Record<string, unknown> => {
  if (typeof error !== "object" || error === null) {
    return { _tag: "UnknownError", message: String(error) };
  }
  const value = error as { readonly _tag?: unknown; readonly message?: unknown };
  const tag = typeof value._tag === "string" ? value._tag : "UnknownError";
  const result: Record<string, unknown> = { _tag: tag, message: "" };
  for (const [key, entry] of Object.entries(error)) {
    if (key !== "_tag" && key !== "message") result[key] = entry;
  }
  const explicitMessage = typeof value.message === "string" ? value.message : "";
  result.message =
    explicitMessage.length > 0
      ? explicitMessage
      : Object.keys(result).length > 2
        ? `${tag}: ${JSON.stringify(
            Object.fromEntries(
              Object.entries(result).filter(([key]) => key !== "_tag" && key !== "message"),
            ),
          )}`
        : String(error);
  return result;
};

let failureWasReported = false;

const reportFailure = (json: boolean, command: string, error: unknown): Effect.Effect<void> => {
  const details = errorRecord(error);
  return Effect.sync(() => {
    failureWasReported = true;
  }).pipe(
    Effect.andThen(
      json
        ? Console.log(JSON.stringify({ ok: false, command, error: details }))
        : Console.error(`${String(details._tag)}: ${String(details.message)}`),
    ),
  );
};

const report = <A, E>(options: {
  readonly command: string;
  readonly json: boolean;
  readonly operation: Effect.Effect<A, E>;
  readonly success: (value: A) => Record<string, unknown>;
  readonly summary: (value: A) => string;
}): Effect.Effect<void, E> =>
  Effect.matchEffect(options.operation, {
    onFailure: (error) =>
      reportFailure(options.json, options.command, error).pipe(Effect.andThen(Effect.fail(error))),
    onSuccess: (value) =>
      options.json
        ? Console.log(
            JSON.stringify({ ok: true, command: options.command, ...options.success(value) }),
          )
        : Console.log(options.summary(value)),
  });

const manifestWrite = Command.make(
  "write",
  {
    module: moduleFlag,
    export: exportFlag,
    output: outputFlag,
    json: jsonFlag,
  },
  ({ module: modulePath, export: exportName, output, json }) =>
    report({
      command: "manifest.write",
      json,
      operation: loadCapsules(modulePath, exportName).pipe(
        Effect.flatMap((capsules) => writeManifest(capsules, output)),
      ),
      success: (manifest) => ({
        output: resolve(output),
        fingerprint: manifest.fingerprint,
        capsules: capsuleCount(manifest),
        migrations: migrationCount(manifest),
      }),
      summary: (manifest) =>
        `Wrote ${resolve(output)} (${capsuleCount(manifest)} capsule(s), ${migrationCount(manifest)} migration(s), fingerprint ${manifest.fingerprint})`,
    }),
).pipe(
  Command.withDescription(
    "Build and write a deterministic manifest from an explicit module export.",
  ),
);

const manifestCheck = Command.make(
  "check",
  {
    module: moduleFlag,
    export: exportFlag,
    manifest: manifestFlag,
    json: jsonFlag,
  },
  ({ module: modulePath, export: exportName, manifest: manifestPath, json }) =>
    report({
      command: "manifest.check",
      json,
      operation: Effect.gen(function* () {
        const capsules = yield* loadCapsules(modulePath, exportName);
        const expectedInput = yield* readJson<unknown>(manifestPath, "manifest input");
        const expected = yield* decodeManifest(expectedInput);
        return yield* validateManifest({ capsules, expected });
      }),
      success: (manifest) => ({
        manifest: resolve(manifestPath),
        fingerprint: manifest.fingerprint,
        capsules: capsuleCount(manifest),
        migrations: migrationCount(manifest),
      }),
      summary: (manifest) =>
        `Manifest is current (${capsuleCount(manifest)} capsule(s), ${migrationCount(manifest)} migration(s), fingerprint ${manifest.fingerprint})`,
    }),
).pipe(
  Command.withDescription("Check a manifest against an explicit module export without mutation."),
);

const d1ArtifactWrite = Command.make(
  "artifact",
  {
    module: moduleFlag,
    export: exportFlag,
    output: outputFlag,
    json: jsonFlag,
  },
  ({ module: modulePath, export: exportName, output, json }) =>
    report({
      command: "d1.artifact",
      json,
      operation: buildFromInput(modulePath, exportName).pipe(
        Effect.flatMap((manifest) => buildD1Artifact(manifest)),
        Effect.flatMap((artifact) => writeArtifactOutput(output, artifact)),
      ),
      success: (artifact) => ({
        output: resolve(output),
        manifestFingerprint: artifact.manifestFingerprint,
        files: artifact.files.map((file) => file.path),
      }),
      summary: (artifact) =>
        `Wrote D1 artifact ${resolve(output)} (${artifact.files.length} SQL file(s), manifest fingerprint ${artifact.manifestFingerprint})`,
    }),
).pipe(
  Command.withDescription(
    "Generate optional static D1 SQL artifacts from validated manifest bodies.",
  ),
);

const d1ArtifactCheck = Command.make(
  "check",
  {
    module: moduleFlag,
    export: exportFlag,
    artifact: artifactFlag,
    json: jsonFlag,
  },
  ({ module: modulePath, export: exportName, artifact: artifactPath, json }) =>
    report({
      command: "d1.check",
      json,
      operation: Effect.gen(function* () {
        const manifest = yield* buildFromInput(modulePath, exportName);
        const artifact = yield* readArtifactInput(artifactPath);
        const checked = yield* validateD1Artifact({ manifest, artifact });
        yield* checkArtifactFiles(artifactPath, checked);
        return checked;
      }),
      success: (artifact) => ({
        artifact: resolve(artifactPath),
        manifestFingerprint: artifact.manifestFingerprint,
        files: artifact.files.map((file) => file.path),
      }),
      summary: (artifact) =>
        `D1 artifact is current (${artifact.files.length} SQL file(s), manifest fingerprint ${artifact.manifestFingerprint})`,
    }),
).pipe(
  Command.withDescription(
    "Check generated D1 artifacts for stale, edited, missing, or reordered files.",
  ),
);

const manifestCommand = Command.make("manifest").pipe(
  Command.withSubcommands([manifestWrite, manifestCheck]),
);

const d1Command = Command.make("d1").pipe(
  Command.withSubcommands([d1ArtifactWrite, d1ArtifactCheck]),
);

/** The public Effect-native CapsuleDB command tree. */
export const cli = Command.make("capsuledb").pipe(
  Command.withDescription("Build and verify CapsuleDB manifests and optional D1 artifacts."),
  Command.withSubcommands([manifestCommand, d1Command]),
);

/** Run the command tree with explicit arguments; useful for tests and host tooling. */
export const run = (args: ReadonlyArray<string>): Effect.Effect<void, unknown, never> =>
  Command.runWith(cli, { version: VERSION, renderErrors: false })(args) as Effect.Effect<
    void,
    unknown,
    never
  >;

const isInvokedDirectly = (): boolean => {
  const invokedPath = process.argv[1];
  if (invokedPath === undefined) return false;
  try {
    return realpathSync(invokedPath) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
};

const isDirectSqlPath = (path: string): boolean =>
  path.length > 0 && path.endsWith(".sql") && basename(path) === path;

const readOwnedArtifactPaths = (
  output: string,
): Effect.Effect<ReadonlySet<string>, InvalidDefinition> =>
  Effect.gen(function* () {
    const entries = yield* Effect.tryPromise({
      try: () => readdir(resolve(output)),
      catch: (cause) => operationError("D1 artifact directory", cause),
    });
    if (!entries.includes("artifact.json")) {
      const sqlEntry = entries.find((entry) => entry.endsWith(".sql"));
      if (sqlEntry !== undefined) {
        return yield* Effect.fail(
          new InvalidDefinition({
            subject: "D1 artifact directory",
            reason: `cannot regenerate safely: artifact.json is missing while SQL file ${sqlEntry} exists`,
          }),
        );
      }
      return new Set<string>();
    }
    const previousInput = yield* readJson<unknown>(join(output, "artifact.json"), "D1 artifact");
    const previous = yield* decodeD1Artifact(previousInput);
    const owned = new Set<string>();
    for (const file of previous.files) {
      if (!isDirectSqlPath(file.path)) continue;
      const contents = yield* readText(join(output, file.path), `D1 artifact ${file.path}`).pipe(
        Effect.option,
      );
      if (contents._tag === "Some" && contents.value === renderD1ArtifactFile(file)) {
        owned.add(file.path);
      }
    }
    return owned;
  });

const writeArtifactOutput = (
  output: string,
  artifact: D1Artifact,
): Effect.Effect<D1Artifact, InvalidDefinition> =>
  Effect.gen(function* () {
    const absoluteOutput = resolve(output);
    if (extname(absoluteOutput).toLowerCase() === ".json") {
      yield* writeText(absoluteOutput, stringifyD1Artifact(artifact), "D1 artifact output");
      return artifact;
    }
    yield* Effect.tryPromise({
      try: () => mkdir(absoluteOutput, { recursive: true }),
      catch: (cause) => operationError("D1 artifact directory output", cause),
    });
    const expectedPaths = new Set(artifact.files.map((file) => file.path));
    const previouslyOwnedPaths = yield* readOwnedArtifactPaths(absoluteOutput);
    for (const path of previouslyOwnedPaths) {
      if (expectedPaths.has(path)) continue;
      yield* Effect.tryPromise({
        try: () => unlink(join(absoluteOutput, path)),
        catch: (cause) => operationError(`D1 artifact ${path}`, cause),
      });
    }
    yield* writeText(
      join(absoluteOutput, "artifact.json"),
      stringifyD1Artifact(artifact),
      "D1 artifact index output",
    );
    for (const file of artifact.files) {
      yield* writeText(
        join(absoluteOutput, file.path),
        renderD1ArtifactFile(file),
        "D1 artifact SQL output",
      );
    }
    return artifact;
  });

const readArtifactInput = (input: string): Effect.Effect<unknown, InvalidDefinition> =>
  Effect.gen(function* () {
    const absoluteInput = resolve(input);
    const inputStat = yield* Effect.tryPromise({
      try: () => stat(absoluteInput),
      catch: (cause) => operationError("D1 artifact input", cause),
    });
    return yield* readJson<unknown>(
      inputStat.isDirectory() ? join(absoluteInput, "artifact.json") : absoluteInput,
      "D1 artifact input",
    );
  });

const checkArtifactFiles = (
  input: string,
  artifact: D1Artifact,
): Effect.Effect<void, InvalidDefinition> =>
  Effect.gen(function* () {
    const absoluteInput = resolve(input);
    const inputStat = yield* Effect.tryPromise({
      try: () => stat(absoluteInput),
      catch: (cause) => operationError("D1 artifact input", cause),
    });
    if (!inputStat.isDirectory()) return;
    const actualEntries = yield* Effect.tryPromise({
      try: () => readdir(absoluteInput),
      catch: (cause) => operationError("D1 artifact directory", cause),
    });
    const expectedPaths = new Set(artifact.files.map((file) => file.path));
    for (const file of artifact.files) {
      const contents = yield* readText(join(absoluteInput, file.path), `D1 artifact ${file.path}`);
      if (contents !== renderD1ArtifactFile(file)) {
        return yield* Effect.fail(
          new InvalidDefinition({
            subject: `D1 artifact ${file.path}`,
            reason: "SQL file contents differ from the immutable artifact index",
          }),
        );
      }
    }
    for (const entry of actualEntries) {
      if (entry.endsWith(".sql") && !expectedPaths.has(entry)) {
        return yield* Effect.fail(
          new InvalidDefinition({
            subject: "D1 artifact directory",
            reason: `untracked SQL file ${entry}`,
          }),
        );
      }
    }
  });

if (isInvokedDirectly()) {
  void Effect.runPromise(run(process.argv.slice(2)) as Effect.Effect<void, unknown, never>).catch(
    (error: unknown) => {
      if (typeof process !== "undefined") process.exitCode = 1;
      if (error !== undefined && !failureWasReported) {
        const details = errorRecord(error);
        console.error(`${String(details._tag)}: ${String(details.message)}`);
      }
    },
  );
}
