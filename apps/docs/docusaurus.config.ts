import type * as Preset from "@docusaurus/preset-classic";
import type { Config } from "@docusaurus/types";
import { themes as prismThemes } from "prism-react-renderer";

const config: Config = {
	title: "DB-X",
	tagline:
		"Production-grade database schema deployment, with a Time Machine and AI review.",
	favicon: "img/favicon.svg",

	// Published by .github/workflows/docs.yml to GitHub Pages. `db-x.dev` has no
	// DNS yet; when it does, this becomes url "https://db-x.dev" + baseUrl "/"
	// plus a `static/CNAME` holding the domain.
	url: "https://rtorcato.github.io",
	baseUrl: "/db-x/",

	organizationName: "rtorcato",
	// Same GitHub repo as Infra-X — DB-X is a distribution on top of @infra-x/runtime.
	projectName: "db-x",

	onBrokenLinks: "warn",

	markdown: {
		format: "detect",
		hooks: {
			onBrokenMarkdownLinks: "warn",
		},
	},

	i18n: {
		defaultLocale: "en",
		locales: ["en"],
	},

	headTags: [
		{
			// iOS home-screen icon — Docusaurus only emits the `favicon` link.
			tagName: "link",
			attributes: {
				rel: "apple-touch-icon",
				sizes: "512x512",
				href: "/db-x/img/favicon-512.png",
			},
		},
		{
			tagName: "link",
			attributes: { rel: "preconnect", href: "https://fonts.googleapis.com" },
		},
		{
			tagName: "link",
			attributes: {
				rel: "preconnect",
				href: "https://fonts.gstatic.com",
				crossorigin: "anonymous",
			},
		},
	],

	presets: [
		[
			"classic",
			{
				docs: {
					sidebarPath: "./sidebars.ts",
					routeBasePath: "/docs",
					editUrl: "https://github.com/rtorcato/db-x/edit/main/apps/docs/",
				},
				blog: false,
				theme: {
					customCss: "./src/css/custom.css",
				},
			} satisfies Preset.Options,
		],
	],

	plugins: [
		[
			"docusaurus-plugin-typedoc",
			{
				// Auto-generate API reference for the published DB-X libraries.
				entryPoints: [
					"../../packages/runtime/src/index.ts",
					"../../packages/postgres-library/src/index.ts",
				],
				entryPointStrategy: "expand",
				// Scoped tsconfig keeps TypeDoc focused on the DB-X packages only.
				tsconfig: "./typedoc.tsconfig.json",
				out: "docs/api",
				readme: "none",
				includeVersion: false,
				excludePrivate: true,
				excludeInternal: true,
				excludeExternals: true,
				sort: ["source-order"],
				hidePageTitle: false,
				hideBreadcrumbs: false,
				outputFileStrategy: "modules",
				sidebar: {
					autoConfiguration: false,
				},
			},
		],
		[
			"@easyops-cn/docusaurus-search-local",
			{
				hashed: true,
				indexDocs: true,
				indexBlog: false,
				docsRouteBasePath: "/docs",
				highlightSearchTermsOnTargetPage: true,
				searchBarShortcutHint: false,
			},
		],
	],

	themeConfig: {
		// og:image / twitter:card for every page. Relative to static/; Docusaurus
		// makes it absolute against `url` + `baseUrl`, which scrapers need.
		image: "img/social-card.png",
		colorMode: {
			defaultMode: "dark",
			respectPrefersColorScheme: true,
		},
		navbar: {
			title: "DB-X",
			logo: {
				alt: "DB-X",
				// Same mark as the favicon and the README banner.
				src: "img/favicon.svg",
			},
			items: [
				{
					to: "/docs/getting-started/quickstart-docker",
					position: "left",
					label: "Docs",
				},
				{
					to: "/docs/reference/components",
					position: "left",
					label: "Reference",
				},
				{ to: "/docs/examples", position: "left", label: "Examples" },
				{ to: "/docs/api", position: "left", label: "API" },
				{ to: "/docs/about/roadmap", position: "left", label: "Roadmap" },
				{
					href: "https://infra-x.dev",
					label: "Infra-X",
					position: "right",
				},
				{
					href: "https://github.com/rtorcato/db-x",
					label: "GitHub",
					position: "right",
				},
			],
		},
		footer: {
			style: "dark",
			links: [
				{
					title: "Documentation",
					items: [
						{
							label: "Quickstart (Docker)",
							to: "/docs/getting-started/quickstart-docker",
						},
						{
							label: "Quickstart (managed DB)",
							to: "/docs/getting-started/quickstart-managed",
						},
						{ label: "Components reference", to: "/docs/reference/components" },
						{ label: "Roadmap", to: "/docs/about/roadmap" },
					],
				},
				{
					title: "Companion projects",
					items: [
						{ label: "Infra-X", href: "https://infra-x.dev" },
						{
							label: "js-common",
							href: "https://rtorcato.github.io/js-common/",
						},
						{
							label: "browser-common",
							href: "https://rtorcato.github.io/browser-common/",
						},
					],
				},
				{
					title: "Resources",
					items: [
						{ label: "GitHub", href: "https://github.com/rtorcato/db-x" },
						{
							label: "Issues",
							href: "https://github.com/rtorcato/db-x/issues",
						},
						{
							label: "Licensing",
							href: "https://github.com/rtorcato/db-x/blob/main/LICENSING.md",
						},
					],
				},
			],
			copyright: `Copyright © ${new Date().getFullYear()} Richard Torcato. Built with Docusaurus.`,
		},
		prism: {
			theme: prismThemes.vsDark,
			darkTheme: prismThemes.vsDark,
			additionalLanguages: ["bash", "json", "typescript", "tsx", "sql", "yaml"],
		},
	} satisfies Preset.ThemeConfig,
};

export default config;
