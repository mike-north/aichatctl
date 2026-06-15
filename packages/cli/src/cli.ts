import { Command, CommanderError, InvalidArgumentError } from "commander";

import {
  AichatctlError,
  DEFAULT_CDP_PORT,
  PLATFORMS,
  buildNotebookSources,
  createNotebookPodcast,
  createSeededSession,
  createSeededSessionViaApplescript,
  doctor,
  doctorApplescript,
  launchChrome,
  listProjects,
  parseAudioFormat,
  parseAudioLength,
  planHasChanges,
  readPromptSource,
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

/** Commander reducer: accumulate a repeatable option into an array. */
function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
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
      lines.push(`CDP ${report.cdpReachable ? "reachable" : "UNREACHABLE"} on port ${String(report.cdpPort)}`);
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
    .option("--transport <t>", "cdp | applescript (gemini: applescript only)", parseTransport, "cdp")
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
        emit(
          io,
          opts.json,
          `${result.sent ? "Started" : "Staged"} session: ${result.url}`,
          result,
        );
      },
    );

  // notebook create ------------------------------------------------------------
  const notebook = program.command("notebook").description("Create NotebookLM notebooks + podcasts");
  notebook
    .command("create")
    .description("Create a notebook, add sources, and kick off an Audio Overview (podcast)")
    .option("--source <path>", "file or directory to add as a source (repeatable)", collect, [])
    .option("--source-url <url>", "URL to add as its own source (repeatable)", collect, [])
    .option("--source-text <text>", 'inline text source ("-" reads stdin)')
    .option("--format <format>", "deep-dive | brief | critique | debate", "deep-dive")
    .option("--length <length>", "short | default | long", "default")
    .option("--prompt <text>", "what the AI hosts should focus on")
    .option("--prompt-file <path>", 'read the host-focus prompt from a file ("-" for stdin)')
    // Only `applescript` is valid today; the flag exists for consistency with other
    // commands and to leave room for future transports. The guard below rejects others.
    .option("--transport <t>", "applescript (only)", parseTransport, "applescript")
    .option("--json", "machine-readable output", false)
    .action(
      async (opts: {
        source: string[];
        sourceUrl: string[];
        sourceText?: string;
        format: string;
        length: string;
        prompt?: string;
        promptFile?: string;
        transport: Transport;
        json: boolean;
      }) => {
        if (opts.sourceText === "-" && opts.promptFile === "-") {
          throw new AichatctlError(
            "Cannot read both --source-text and --prompt-file from stdin in the same invocation.",
          );
        }
        if (opts.transport !== "applescript") {
          throw new AichatctlError(
            "NotebookLM is supported only via the AppleScript transport. Re-run with --transport applescript.",
          );
        }
        const format = parseAudioFormat(opts.format);
        const length = parseAudioLength(opts.length);
        const text =
          opts.sourceText === "-" ? readPromptSource("-") : opts.sourceText;
        const sources = buildNotebookSources({
          files: opts.source,
          urls: opts.sourceUrl,
          ...(text !== undefined ? { text } : {}),
        });
        if (sources.length === 0) {
          throw new AichatctlError(
            "Provide at least one source: --source, --source-url, or --source-text.",
          );
        }
        const prompt =
          opts.promptFile !== undefined ? readPromptSource(opts.promptFile) : opts.prompt;
        const result = await createNotebookPodcast({
          sources,
          audio: { format, length, ...(prompt !== undefined ? { prompt } : {}) },
        });
        emit(
          io,
          opts.json,
          `Created notebook + kicked off ${format} podcast: ${result.url}`,
          result,
        );
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
