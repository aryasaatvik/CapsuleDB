#!/usr/bin/env bun

import { runCli } from "tegami/cli";
import { github } from "tegami/plugins/github";
import { tegami, type TegamiPlugin } from "tegami";

const PACKAGE_ID = "npm:capsuledb";
const REPOSITORY = "aryasaatvik/CapsuleDB";

const releaseChecks = (): TegamiPlugin => ({
  name: "capsuledb-release-checks",
  enforce: "pre",
  async afterPreflight({ plan }) {
    if (plan.packages.get(PACKAGE_ID)?.preflight?.shouldPublish !== true) return;
    const child = Bun.spawn(["bun", "run", "release:check"], {
      cwd: this.cwd,
      stderr: "inherit",
      stdout: "inherit",
    });
    if ((await child.exited) !== 0) throw new Error("CapsuleDB release gate failed");
  },
});

const versionTag = (): TegamiPlugin => ({
  name: "capsuledb-version-tag",
  enforce: "post",
  initPublishPlan({ plan }) {
    const pkg = this.graph.get(PACKAGE_ID);
    const packagePlan = plan.packages.get(PACKAGE_ID);
    if (pkg?.version === undefined || packagePlan === undefined) return;
    packagePlan.git ??= {};
    packagePlan.git.tag = `v${pkg.version}`;
  },
});

const paper = tegami({
  groups: {
    public: {
      syncBump: true,
    },
  },
  packages: {
    capsuledb: { group: "public" },
  },
  npm: {
    client: "bun",
    onBreakPeerDep: "error",
    trustedPublish: {
      provider: "github",
      workflow: "publish.yml",
    },
    updateLockFile: true,
  },
  plugins: [
    github({
      repo: REPOSITORY,
      pushTags: true,
      release: {
        create({ tag }) {
          return { title: tag };
        },
      },
      versionPr: {
        base: "main",
        branch: "tegami/version-packages",
        forceCreate: false,
        create() {
          return { title: "chore(release): prepare CapsuleDB" };
        },
      },
    }),
    releaseChecks(),
    versionTag(),
  ],
});

await runCli(paper);
