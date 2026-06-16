import { Command, CommanderError, InvalidArgumentError } from "commander";

import {
  AichatctlError,
  DEFAULT_CDP_PORT,
  NotebookLmDriver,
  PLATFORMS,
  addNotebookSource,
  createEmptyNotebook,
  createSeededSession,
  createSeededSessionViaApplescript,
  doctor,
  doctorApplescript,
  generateNotebookPodcast,
  launchChrome,
  listNotebookSources,
  listProjects,
  parseAudioFormat,
  parseAudioLength,
  planHasChanges,
  readPromptSource,
  removeNotebookSource,
  renameNotebook,
  runSync,
} from "@aichatctl/sdk";
import type { Platform } from "@aichatctl/sdk";

import { getCliVersion } from "./version.js";

/** Writer abstraction so the program is testable without touching process.stdout. */
export interface IO {
  out(line: string): void;
  err(line: string): void;
}

const defaultIO: IO = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
};

function parsePlatform(value: string): Platform {
  if ((PLATFORMS as readonly string[]).includes(value)) {
    return value as Platform;
  }
  throw new InvalidArgumentError(`platform must be one of: ${PLATFORMS.join(", ")}`);
}

function parsePort(value: string): number {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n) || n <= 0 || n > 65535) {
    throw new InvalidArgumentError("port must be an integer in 1..65535");
  }
  return n;
}

type Transport = "cdp" | "applescript";

function parseTransport(value: string): Transport {
  if (value === "cdp" || value === "applescript") {
    return value;
  }
  throw new InvalidArgumentError("transport must be 'cdp' or 'applescript'");
}

function emit(io: IO, json: boolean, human: string, data: unknown): void {
  io.out(json ? JSON.stringify(data, null, 2) : human);
}

/** Builds the commander program. Exposed for testing. */
export function buildProgram(io: IO = defaultIO): Command {
  const program = new Command();
  program
    .name("aichatctl")
    .description("Drive the Claude.ai and ChatGPT web UIs: sync project files and seed sessions.")
    .version(getCliVersion(), "-v, --version")
    .exitOverride()
    .configureOutput({
      writeOut: (str) => {
        io.out(str.replace(/\n$/, ""));
      },
      writeErr: (str) => {
        io.err(str.replace(/\n$/, ""));
      },
    });

  const portOption = (cmd: Command): Command =>
    cmd.option("-p, --port <port>", "CDP remote-debugging port", parsePort, DEFAULT_CDP_PORT);

  // browser launch -------------------------------------------------------------
  const browser = program.command("browser").description("Manage the automation browser");
  portOption(browser.command("launch"))
    .description("Launch Chrome with remote debugging using the dedicated automation profile")
    .action((opts: { port: number }) => {
      const result = launchChrome({ port: opts.port });
      io.out(`Launched Chrome (pid ${String(result.pid ?? "?")}) on port ${String(opts.port)}.`);
      io.out(`Profile: ${result.userDataDir}`);
      io.out("If this is the first launch, sign in to claude.ai and chatgpt.com in that window.");
    });

  // doctor ---------------------------------------------------------------------
  portOption(program.command("doctor"))
    .description("Check transport readiness (CDP reachability / AppleScript prerequisites + login)")
    .option("--transport <t>", "cdp | applescript", parseTransport, "cdp")
    .option("--json", "machine-readable output", false)
    .action(async (opts: { port: number; transport: Transport; json: boolean }) => {
      if (opts.transport === "applescript") {
        const report = await doctorApplescript();
        const lines: string[] = [];
        lines.push(
          report.jsFromAppleEventsEnabled
            ? "Chrome: 'Allow JavaScript from Apple Events' enabled"
            : "Chrome: 'Allow JavaScript from Apple Events' is OFF — enable it (View → Developer).",
        );
        for (const p of report.platforms) {
          lines.push(`${p.platform}: login=${String(p.loggedIn)}${p.error ? ` (${p.error})` : ""}`);
        }
        lines.push(report.ok ? "OK" : "Problems found.");
        emit(io, opts.json, lines.join("\n"), report);
        if (!report.ok) {
          process.exitCode = 1;
        }
        return;
      }
      const report = await doctor({ port: opts.port });
      const lines: string[] = [];
      lines.push(
        `CDP ${report.cdpReachable ? "reachable" : "UNREACHABLE"} on port ${String(report.cdpPort)}`,
      );
      if (!report.cdpReachable) {
        lines.push("Run `aichatctl browser launch` first.");
      }
      for (const p of report.platforms) {
        const probes = p.probes.map((x) => `${x.ok ? "ok" : "MISSING"}:${x.name}`).join(", ");
        lines.push(`${p.platform}: login=${String(p.loggedIn)} ${probes ? `[${probes}]` : ""}`);
      }
      lines.push(report.ok ? "OK" : "Problems found.");
      emit(io, opts.json, lines.join("\n"), report);
      if (!report.ok) {
        process.exitCode = 1;
      }
    });

  // project list ---------------------------------------------------------------
  const project = program.command("project").description("Inspect web projects");
  portOption(project.command("list"))
    .description("List projects on a platform")
    .requiredOption("--platform <platform>", "claude | chatgpt", parsePlatform)
    .option("--json", "machine-readable output", false)
    .action(async (opts: { platform: Platform; port: number; json: boolean }) => {
      const projects = await listProjects({ platform: opts.platform, port: opts.port });
      const human = projects.length
        ? projects.map((p) => `${p.name}\t${p.url}`).join("\n")
        : "(no projects found)";
      emit(io, opts.json, human, projects);
    });

  // sync -----------------------------------------------------------------------
  portOption(program.command("sync"))
    .description("Mirror declared local files + instructions into the project library")
    .option("-c, --config <path>", "manifest path", "aichatctl.config.yaml")
    .option("--platform <platform>", "limit to one platform", parsePlatform)
    .option("--dry-run", "compute the plan without making changes", false)
    .option("--transport <t>", "cdp | applescript", parseTransport, "cdp")
    .option("--json", "machine-readable output", false)
    .action(
      async (opts: {
        config: string;
        platform?: Platform;
        dryRun: boolean;
        transport: Transport;
        port: number;
        json: boolean;
      }) => {
        const reports = await runSync({
          configPath: opts.config,
          dryRun: opts.dryRun,
          port: opts.port,
          transport: opts.transport,
          ...(opts.platform ? { platforms: [opts.platform] } : {}),
        });
        const lines: string[] = [];
        for (const r of reports) {
          lines.push(`# ${r.platform} :: ${r.project.name} (${r.applied ? "applied" : "dry-run"})`);
          for (const s of r.steps) {
            lines.push(`  ${s.action.padEnd(7)} ${s.name}  — ${s.reason}`);
          }
          if (r.instructions.managed) {
            lines.push(`  instructions: ${r.instructions.reason}`);
          }
          if (!planHasChanges(r.steps) && !r.instructions.willUpdate) {
            lines.push("  (already in sync)");
          }
        }
        emit(io, opts.json, lines.join("\n"), reports);
      },
    );

  // session create -------------------------------------------------------------
  const session = program.command("session").description("Manage chat sessions");
  portOption(session.command("create"))
    .description("Create a new chat session in a project, seeded with a prompt")
    .requiredOption("--platform <platform>", "claude | chatgpt | gemini", parsePlatform)
    .requiredOption(
      "--project <ref>",
      'project name, URL, or id (Gemini: a Gem URL/id, or "new" for a plain chat)',
    )
    .option("--seed <text>", "seed prompt text")
    .option("--seed-file <path>", 'read seed prompt from a file ("-" for stdin)')
    .option("--no-send", "stage the prompt without submitting it")
    .option(
      "--transport <t>",
      "cdp | applescript (gemini: applescript only)",
      parseTransport,
      "cdp",
    )
    .option("--json", "machine-readable output", false)
    .action(
      async (opts: {
        platform: Platform;
        project: string;
        seed?: string;
        seedFile?: string;
        send: boolean;
        transport: Transport;
        port: number;
        json: boolean;
      }) => {
        const prompt = opts.seedFile !== undefined ? readPromptSource(opts.seedFile) : opts.seed;
        if (prompt === undefined || prompt.trim().length === 0) {
          throw new AichatctlError("Provide a non-empty --seed or --seed-file.");
        }
        if (opts.platform === "gemini" && opts.transport !== "applescript") {
          throw new AichatctlError(
            "Gemini is supported only via the AppleScript transport. Re-run with --transport applescript.",
          );
        }
        const common = {
          platform: opts.platform,
          project: opts.project,
          prompt,
          send: opts.send,
        };
        let result;
        if (opts.transport === "applescript") {
          result = await createSeededSessionViaApplescript(common);
        } else {
          result = await createSeededSession({ ...common, port: opts.port });
        }
        emit(io, opts.json, `${result.sent ? "Started" : "Staged"} session: ${result.url}`, result);
      },
    );

  // notebook commands -----------------------------------------------------------
  const notebook = program.command("notebook").description("NotebookLM notebooks and podcasts");

  notebook
    .command("new")
    .description("Create an empty NotebookLM notebook")
    .option("--name <name>", "name for the notebook")
    .option("--transport <t>", "applescript (only)", parseTransport, "applescript")
    .option("--json", "machine-readable output", false)
    .action(async (opts: { name?: string; transport: Transport; json: boolean }) => {
      if (opts.transport !== "applescript") {
        throw new AichatctlError(
          "NotebookLM is supported only via the AppleScript transport. Re-run with --transport applescript.",
        );
      }
      const result = await createEmptyNotebook({
        ...(opts.name !== undefined ? { name: opts.name } : {}),
      });
      emit(
        io,
        opts.json,
        `Created notebook${result.name ? ` "${result.name}"` : ""}: ${result.url}`,
        result,
      );
    });

  notebook
    .command("rename")
    .description("Rename an existing notebook")
    .requiredOption("--notebook <ref>", "notebook URL or UUID")
    .requiredOption("--name <name>", "new name for the notebook")
    .option("--transport <t>", "applescript (only)", parseTransport, "applescript")
    .option("--json", "machine-readable output", false)
    .action(
      async (opts: { notebook: string; name: string; transport: Transport; json: boolean }) => {
        if (opts.transport !== "applescript") {
          throw new AichatctlError(
            "NotebookLM is supported only via the AppleScript transport. Re-run with --transport applescript.",
          );
        }
        await renameNotebook({ notebook: opts.notebook, name: opts.name });
        const nb = NotebookLmDriver.parseNotebookRef(opts.notebook);
        emit(io, opts.json, `Renamed notebook to "${opts.name}": ${nb.url}`, {
          id: nb.id,
          url: nb.url,
          name: opts.name,
        });
      },
    );

  const sources = notebook.command("sources").description("Manage notebook sources");
  sources
    .command("list")
    .description("List sources in a notebook")
    .requiredOption("--notebook <ref>", "notebook URL or UUID")
    .option("--transport <t>", "applescript (only)", parseTransport, "applescript")
    .option("--json", "machine-readable output", false)
    .action(async (opts: { notebook: string; transport: Transport; json: boolean }) => {
      if (opts.transport !== "applescript") {
        throw new AichatctlError(
          "NotebookLM is supported only via the AppleScript transport. Re-run with --transport applescript.",
        );
      }
      const result = await listNotebookSources({ notebook: opts.notebook });
      const human = result.sources.length
        ? result.sources.map((s, i) => `${String(i + 1)}. ${s}`).join("\n")
        : "(no sources)";
      emit(io, opts.json, human, result);
    });

  sources
    .command("remove")
    .description("Remove a source from a notebook")
    .requiredOption("--notebook <ref>", "notebook URL or UUID")
    .requiredOption("--source <name>", "source name (or prefix) to remove")
    .option("--transport <t>", "applescript (only)", parseTransport, "applescript")
    .option("--json", "machine-readable output", false)
    .action(
      async (opts: { notebook: string; source: string; transport: Transport; json: boolean }) => {
        if (opts.transport !== "applescript") {
          throw new AichatctlError(
            "NotebookLM is supported only via the AppleScript transport. Re-run with --transport applescript.",
          );
        }
        await removeNotebookSource({ notebook: opts.notebook, source: opts.source });
        emit(io, opts.json, `Removed source "${opts.source}"`, {
          notebook: opts.notebook,
          source: opts.source,
          removed: true,
        });
      },
    );

  sources
    .command("add")
    .description("Add a source to a notebook (text content or URL)")
    .requiredOption("--notebook <ref>", "notebook URL or UUID")
    .option("--text <content>", "text content to add as a source")
    .option("--text-file <path>", 'read text source from a file ("-" for stdin)')
    .option("--url <url>", "URL to add as a source")
    .option("--transport <t>", "applescript (only)", parseTransport, "applescript")
    .option("--json", "machine-readable output", false)
    .action(
      async (opts: {
        notebook: string;
        text?: string;
        textFile?: string;
        url?: string;
        transport: Transport;
        json: boolean;
      }) => {
        if (opts.transport !== "applescript") {
          throw new AichatctlError(
            "NotebookLM is supported only via the AppleScript transport. Re-run with --transport applescript.",
          );
        }
        let kind: "text" | "url";
        let content: string;
        if (opts.url !== undefined) {
          kind = "url";
          content = opts.url;
        } else if (opts.textFile !== undefined) {
          kind = "text";
          content = readPromptSource(opts.textFile);
        } else if (opts.text !== undefined) {
          kind = "text";
          content = opts.text;
        } else {
          throw new AichatctlError("Provide one of --text, --text-file, or --url.");
        }
        const result = await addNotebookSource({ notebook: opts.notebook, kind, content });
        emit(io, opts.json, `Added source: "${result.title}"`, {
          notebook: opts.notebook,
          title: result.title,
        });
      },
    );

  const podcast = notebook.command("podcast").description("Audio Overview (podcast) operations");
  podcast
    .command("create")
    .description("Generate an Audio Overview from an existing notebook's sources")
    .requiredOption("--notebook <ref>", "notebook URL or UUID")
    .option("--type <type>", "deep-dive | brief | critique | debate", "deep-dive")
    .option("--length <length>", "short | default | long", "default")
    .option("--prompt <text>", "what the AI hosts should focus on")
    .option("--prompt-file <path>", 'read the host-focus prompt from a file ("-" for stdin)')
    .option("--transport <t>", "applescript (only)", parseTransport, "applescript")
    .option("--json", "machine-readable output", false)
    .action(
      async (opts: {
        notebook: string;
        type: string;
        length: string;
        prompt?: string;
        promptFile?: string;
        transport: Transport;
        json: boolean;
      }) => {
        if (opts.transport !== "applescript") {
          throw new AichatctlError(
            "NotebookLM is supported only via the AppleScript transport. Re-run with --transport applescript.",
          );
        }
        const format = parseAudioFormat(opts.type);
        const length = parseAudioLength(opts.length);
        const prompt =
          opts.promptFile !== undefined ? readPromptSource(opts.promptFile) : opts.prompt;
        const nb = NotebookLmDriver.parseNotebookRef(opts.notebook);
        await generateNotebookPodcast({
          notebook: opts.notebook,
          audio: { format, length, ...(prompt !== undefined ? { prompt } : {}) },
        });
        emit(io, opts.json, `Kicked off ${format} podcast: ${nb.url}`, {
          id: nb.id,
          url: nb.url,
          format,
          length,
        });
      },
    );

  return program;
}

/** Parses argv and runs the program, mapping SDK errors to clean exits. */
export async function run(argv: readonly string[], io: IO = defaultIO): Promise<number> {
  try {
    await buildProgram(io).parseAsync([...argv], { from: "node" });
    const code = process.exitCode ?? 0;
    return typeof code === "number" ? code : Number(code) || 0;
  } catch (error) {
    if (error instanceof CommanderError) {
      // Help/version are normal terminations; other Commander errors are usage errors.
      if (error.code === "commander.helpDisplayed" || error.code === "commander.version") {
        return 0;
      }
      return typeof error.exitCode === "number" ? error.exitCode : 1;
    }
    if (error instanceof AichatctlError) {
      io.err(`error: ${error.message}`);
      return 1;
    }
    io.err(`error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
