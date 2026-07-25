import Link from "@docusaurus/Link";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import CodeBlock from "@theme/CodeBlock";
import Layout from "@theme/Layout";
import TabItem from "@theme/TabItem";
import Tabs from "@theme/Tabs";
import clsx from "clsx";
import type { ReactNode } from "react";
import styles from "./index.module.css";

type Example = {
	label: string;
	file: string;
	language: string;
	code: string;
};

// Same schema, two runtimes — DB-X's core story rendered as a tabbed window.
const EXAMPLES: Example[] = [
	{
		label: "Schema",
		file: "schema.tsx",
		language: "tsx",
		code: `/** @jsxImportSource @db-x/runtime */
import { Column, Postgres, Table } from '@db-x/postgres-library';

// The single source of truth. Both runtimes below apply this exact tree.
export const schema = (
  <Postgres name="todos-db">
    <Table name="todos">
      <Column name="id" type="serial" primaryKey />
      <Column name="title" type="text" notNull />
      <Column name="done" type="boolean" notNull default="false" />
    </Table>
  </Postgres>
);`,
	},
	{
		label: "Managed DB",
		file: "dbx.tsx",
		language: "tsx",
		code: `/** @jsxImportSource @db-x/runtime */
import { DatabaseTarget } from '@db-x/runtime';
import { schema } from './schema';

// Production: point at an existing RDS / Cloud SQL / Supabase URL.
export default (
  <DatabaseTarget url={process.env.DATABASE_URL!}>
    {schema}
  </DatabaseTarget>
);`,
	},
	{
		label: "Local (Docker)",
		file: "infra.tsx",
		language: "tsx",
		code: `/** @jsxImportSource @infra-x/runtime */
import { DockerCompose, Service } from '@infra-x/docker-library';
import { schema } from './schema';

// Local dev / CI: stand Postgres up in Compose, then apply the schema.
export default (
  <DockerCompose>
    <Service name="db" image="postgres:16-alpine">
      {schema}
    </Service>
  </DockerCompose>
);`,
	},
];

function Hero(): ReactNode {
	const { siteConfig } = useDocusaurusContext();
	return (
		<header className={clsx("hero", styles.hero)}>
			<div className="container">
				<h1 className={styles.heroTitle}>{siteConfig.title}</h1>
				<p className={styles.heroTagline}>{siteConfig.tagline}</p>
				<p className={styles.heroDesc}>
					Drizzle and Prisma own the application side. DB-X owns the{" "}
					<span className={styles.accent}>operations side</span> — preview,
					apply, snapshot, restore, and let an AI agent review your schema
					change before it ships.
				</p>
				<div className={styles.heroActions}>
					<Link
						className="button button--primary button--lg"
						to="/docs/getting-started/quickstart-docker"
					>
						Quickstart (Docker)
					</Link>
					<Link
						className="button button--secondary button--lg"
						to="/docs/getting-started/quickstart-managed"
					>
						Quickstart (managed DB)
					</Link>
					<Link
						className="button button--outline button--lg"
						href="https://github.com/rtorcato/infra-x"
					>
						GitHub
					</Link>
				</div>
			</div>
		</header>
	);
}

function CodeSample(): ReactNode {
	return (
		<section className={styles.sample}>
			<div className="container">
				<h2 className={styles.sectionHeading}>
					The schema is the source of truth
				</h2>
				<p className={styles.sectionLede}>
					A DB-X schema is a JSX component. Apply it to a managed Postgres via{" "}
					<code>{"<DatabaseTarget>"}</code>, or stand up a fresh container in a
					single Compose stack via <code>{"<Service>"}</code> — the same schema,
					two distributions.
				</p>
				<div className={styles.codeWindow}>
					<Tabs className={styles.codeTabs} groupId="hero-example">
						{EXAMPLES.map((ex) => (
							<TabItem key={ex.label} value={ex.label} label={ex.label}>
								<div className={styles.codeFile}>{ex.file}</div>
								<CodeBlock language={ex.language} className={styles.codePre}>
									{ex.code}
								</CodeBlock>
							</TabItem>
						))}
					</Tabs>
				</div>
			</div>
		</section>
	);
}

function Pillars(): ReactNode {
	const items = [
		{
			title: "Time Machine",
			body: "Snapshot before every apply. Restore in one command. Diff any two points in time. Pg_dump for self-hosted, RDS / Cloud SQL APIs for managed.",
		},
		{
			title: "Shadow-DB preview",
			body: "Spin an ephemeral copy, dry-run the DDL, report timings and lock contention before the real apply. Find the bad migration on staging, not at 2am.",
		},
		{
			title: "AI review built in",
			body: "An MCP server exposes describe, explain, graph, and preview as tools. Claude Code / Cursor / Cline can review the change against the live schema before you ship.",
		},
		{
			title: "Stays out of your ORM",
			body: "DB-X owns deployment, not your query layer. Keep Drizzle, Prisma, sqlc, or whatever — DB-X exports types so the two stay in sync.",
		},
	];
	return (
		<section className={styles.pillars}>
			<div className="container">
				<div className={styles.pillarGrid}>
					{items.map((p) => (
						<div key={p.title} className={styles.pillar}>
							<h3>{p.title}</h3>
							<p>{p.body}</p>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}

function SectionLinks(): ReactNode {
	const items = [
		{
			to: "/docs/getting-started/install",
			title: "Install",
			blurb: "Get the db-x binary and @db-x/postgres-library on your machine.",
		},
		{
			to: "/docs/getting-started/quickstart-docker",
			title: "Quickstart with Docker",
			blurb: "Stand up Postgres in Compose and apply your first schema.",
		},
		{
			to: "/docs/getting-started/quickstart-managed",
			title: "Quickstart with a managed DB",
			blurb: "Point DB-X at an existing RDS, Cloud SQL, or Supabase URL.",
		},
		{
			to: "/docs/concepts/time-machine",
			title: "Time Machine",
			blurb: "How snapshots, restore, and diff work across managed providers.",
		},
		{
			to: "/docs/concepts/ai-review",
			title: "AI review",
			blurb: "Wire the MCP server into Claude Code or Cursor.",
		},
		{
			to: "/docs/about/roadmap",
			title: "Roadmap",
			blurb: "What is shipped, in progress, and planned next.",
		},
	];
	return (
		<section className={styles.sectionLinks}>
			<div className="container">
				<h2 className={styles.sectionHeading}>Jump in</h2>
				<div className={styles.cardGrid}>
					{items.map((c) => (
						<Link key={c.to} to={c.to} className={styles.card}>
							<h3>{c.title}</h3>
							<p>{c.blurb}</p>
						</Link>
					))}
				</div>
			</div>
		</section>
	);
}

export default function Home(): ReactNode {
	return (
		<Layout
			title="DB-X"
			description="Production-grade database schema deployment with a Time Machine and AI review."
		>
			<Hero />
			<main>
				<CodeSample />
				<Pillars />
				<SectionLinks />
			</main>
		</Layout>
	);
}
