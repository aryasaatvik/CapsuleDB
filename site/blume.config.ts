import { defineConfig } from "blume";
import { orama } from "blume/search";
import { filesystem } from "blume/sources";

import darkTheme from "./themes/capsuledb-dark.json" with { type: "json" };
import lightTheme from "./themes/capsuledb-light.json" with { type: "json" };

export default defineConfig({
  agents: {
    llmsTxt: true,
  },
  content: {
    sources: [filesystem({ prefix: "docs", root: "content" })],
  },
  deployment: {
    site: "https://capsuledb.arya.sh",
  },
  description:
    "CapsuleDB lets an Effect library own its tables, typed queries and migrations inside the host app's existing database.",
  footer: {
    copyright: "MIT licensed. Built by Saatvik Arya.",
    links: [
      { href: "https://www.npmjs.com/package/capsuledb", label: "npm" },
      { href: "/docs/changelog", label: "Changelog" },
      { href: "/sitemap.xml", label: "Sitemap" },
    ],
  },
  github: {
    dir: "site",
    owner: "aryasaatvik",
    repo: "CapsuleDB",
  },
  lastModified: "git",
  logo: {
    image: "/brand/capsuledb-mark.svg",
    text: "CapsuleDB",
  },
  markdown: {
    code: {
      theme: { dark: darkTheme, light: lightTheme },
    },
  },
  navigation: {
    repo: true,
    tabs: [
      { label: "Docs", path: "/docs" },
      { label: "Quick start", path: "/docs/quickstart" },
      { label: "Changelog", path: "/docs/changelog" },
    ],
  },
  search: orama(),
  seo: {
    og: {
      titles: {
        "/": "Ship persistence with your package",
      },
    },
    software: {
      applicationCategory: "DeveloperApplication",
      description:
        "An open-source TypeScript library that lets an Effect package own private tables, typed queries and migrations inside the host app's database.",
      license: "MIT",
      name: "CapsuleDB",
      price: 0,
      priceCurrency: "USD",
      sameAs: [
        "https://github.com/aryasaatvik/CapsuleDB",
        "https://www.npmjs.com/package/capsuledb",
      ],
    },
  },
  theme: {
    accent: { dark: "#ff8f6e", light: "#b23d1a" },
    fonts: {
      body: { name: "Archivo", weights: [400, 500, 600, 700] },
      display: { name: "Archivo", weights: [400, 500, 600, 700] },
      mono: "jetbrains-mono",
    },
    mode: "system",
    radius: "sm",
  },
  title: "CapsuleDB",
});
