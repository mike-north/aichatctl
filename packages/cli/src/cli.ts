import { writeFileSync } from "node:fs";

import { Command, CommanderError, InvalidArgumentError } from "commander";

import {
  AichatctlError,
  NotebookLmDriver,
  PLATFORMS,
  addNotebookSource,
  createEmptyNotebook,
  createProject,
  createSeededSession,
  doctorApplescript,
  generateNotebookPodcast,
  getNotebookStatus,
  listNotebookSources,
  listProjects,
  parseAudioFormat,
  parseAudioLength,
  planHasChanges,
  pullConversation,
  readPromptSource,
  removeNotebookSource,
  renameNotebook,
  runSync,
} from "@aichatctl/sdk";
import type { Platform, ProfileHint } from "@aichatctl/sdk";

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

function collectRepeatable(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function emit(io: IO, json: boolean, human: string, data: unknown): void {
  io.out(json ? JSON.stringify(data, null, 2) : human);
}

function getProfileHint(opts: {
  browserAccount?: string;
  browserProfile?: string;
}): ProfileHint | undefined {
  if (opts.browserAccount === undefined && opts.browserProfile === undefined) {
    return undefined;
  }
  return {
    ...(opts.browserAccount !== undefined ? { account: opts.browserAccount } : {}),
    ...(opts.browserProfile !== undefined ? { name: opts.browserProfile } : {}),
  };
}

/** Builds the commander program. Exposed for testing. */
export function buildProgram(io: IO = defaultIO): Command {
  const program = new Command();
  program
    .name("aichatctl")
    .description(
      "Drive the Claude.ai, ChatGPT, and NotebookLM web UIs in your real, logged-in Chrome (macOS).",
    )
    .version(getCliVersion(), "-v, --version")
    .option(
      "--browser-account <email>",
      "NotebookLM commands only: target a Chrome profile by signed-in Google account",
    )
    .option(
      "--browser-profile <name>",
      "NotebookLM commands only: target a Chrome profile by display name",
    )
    .exitOverride()
    .configureOutput({
      writeOut: (str) => {
        io.out(str.replace(/\n$/, ""));
      },
      writeErr: (str) => {
        io.err(str.replace(/\n$/, ""));
      },
    });

  // doctor ---------------------------------------------------------------------
  program
    .command("doctor")
    .description(
      "Check readiness: Chrome's 'Allow JavaScript from Apple Events' + per-platform login",
    )
    .option("--json", "machine-readable output", false)
    .action(async (opts: { json: boolean }) => {
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
    });

  // project list ---------------------------------------------------------------
  const project = program.command("project").description("Inspect web projects");
  project
    .command("list")
    .description("List projects on a platform")
    .requiredOption("--platform <platform>", "claude | chatgpt", parsePlatform)
    .option("--json", "machine-readable output", false)
    .action(async (opts: { platform: Platform; json: boolean }) => {
      const projects = await listProjects({ platform: opts.platform });
      // ChatGPT projects can come back without a resolvable URL; omit the empty
      // second column rather than printing a dangling tab.
      const human = projects.length
        ? projects.map((p) => (p.url ? `${p.name}\t${p.url}` : p.name)).join("\n")
        : "(no projects found)";
      emit(io, opts.json, human, projects);
    });

  // project create -------------------------------------------------------------
  project
    .command("create")
    .description("Create a project, optionally with instructions and seed files")
    .requiredOption("--platform <platform>", "claude | chatgpt", parsePlatform)
    .requiredOption("--name <name>", "name for the new project")
    .option("--instructions <text>", "custom instructions text")
    .option("--instructions-file <path>", 'read instructions from a file ("-" for stdin)')
    .option("--file <path>", "local file to upload into the project (repeatable)", collectRepeatable, [])
    .option("--json", "machine-readable output", false)
    .action(
      async (opts: {
        platform: Platform;
        name: string;
        instructions?: string;
        instructionsFile?: string;
        file: string[];
        json: boolean;
      }) => {
        if (opts.platform === "gemini") {
          throw new AichatctlError("project create supports only claude and chatgpt.");
        }
        if (opts.instructions !== undefined && opts.instructionsFile !== undefined) {
          throw new AichatctlError("Provide at most one of --instructions or --instructions-file.");
        }
        const instructions =
          opts.instructionsFile !== undefined
            ? readPromptSource(opts.instructionsFile)
            : opts.instructions;
        const result = await createProject({
          platform: opts.platform,
          name: opts.name,
          ...(instructions !== undefined ? { instructions } : {}),
          ...(opts.file.length > 0 ? { files: opts.file } : {}),
        });
        const human =
          `Created project "${result.project.name}": ${result.project.url}` +
          (result.instructionsSet ? " (instructions set)" : "") +
          (result.filesUploaded.length > 0
            ? ` (+${String(result.filesUploaded.length)} file(s))`
            : "");
        emit(io, opts.json, human, result);
      },
    );

  // sync -----------------------------------------------------------------------
  program
    .command("sync")
    .description("Mirror declared local files + instructions into the project library")
    .option("-c, --config <path>", "manifest path", "aichatctl.config.yaml")
    .option("--platform <platform>", "limit to one platform", parsePlatform)
    .option("--dry-run", "compute the plan without making changes", false)
    .option("--json", "machine-readable output", false)
    .action(
      async (opts: { config: string; platform?: Platform; dryRun: boolean; json: boolean }) => {
        const reports = await runSync({
          configPath: opts.config,
          dryRun: opts.dryRun,
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
  session
    .command("create")
    .description("Create a new chat session in a project, seeded with a prompt")
    .requiredOption("--platform <platform>", "claude | chatgpt | gemini", parsePlatform)
    .requiredOption(
      "--project <ref>",
      'project name, URL, or id (Gemini: a Gem URL/id, or "new" for a plain chat)',
    )
    .option("--seed <text>", "seed prompt text")
    .option("--seed-file <path>", 'read seed prompt from a file ("-" for stdin)')
    .option("--no-send", "stage the prompt without submitting it")
    .option("--json", "machine-readable output", false)
    .action(
      async (opts: {
        platform: Platform;
        project: string;
        seed?: string;
        seedFile?: string;
        send: boolean;
        json: boolean;
      }) => {
        const prompt = opts.seedFile !== undefined ? readPromptSource(opts.seedFile) : opts.seed;
        if (prompt === undefined || prompt.trim().length === 0) {
          throw new AichatctlError("Provide a non-empty --seed or --seed-file.");
        }
        const result = await createSeededSession({
          platform: opts.platform,
          project: opts.project,
          prompt,
          send: opts.send,
        });
        emit(io, opts.json, `${result.sent ? "Started" : "Staged"} session: ${result.url}`, result);
      },
    );

  // notebook commands -----------------------------------------------------------
  const notebook = program.command("notebook").description("NotebookLM notebooks and podcasts");

  notebook
    .command("new")
    .description("Create an empty NotebookLM notebook")
    .option("--name <name>", "name for the notebook")
    .option("--json", "machine-readable output", false)
    .action(async (opts: { name?: string; json: boolean }) => {
      const profile = getProfileHint(program.opts());
      const result = await createEmptyNotebook({
        ...(opts.name !== undefined ? { name: opts.name } : {}),
        ...(profile !== undefined ? { profile } : {}),
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
    .option("--json", "machine-readable output", false)
    .action(async (opts: { notebook: string; name: string; json: boolean }) => {
      const profile = getProfileHint(program.opts());
      await renameNotebook({
        notebook: opts.notebook,
        name: opts.name,
        ...(profile !== undefined ? { profile } : {}),
      });
      const nb = NotebookLmDriver.parseNotebookRef(opts.notebook);
      emit(io, opts.json, `Renamed notebook to "${opts.name}": ${nb.url}`, {
        id: nb.id,
        url: nb.url,
        name: opts.name,
      });
    });

  notebook
    .command("status")
    .description("Report the state of a notebook's Studio artifacts (Audio Overviews, …)")
    .requiredOption("--notebook <ref>", "notebook URL or UUID")
    .option("--json", "machine-readable output", false)
    .action(async (opts: { notebook: string; json: boolean }) => {
      const profile = getProfileHint(program.opts());
      const result = await getNotebookStatus({
        notebook: opts.notebook,
        ...(profile !== undefined ? { profile } : {}),
      });
      const human = result.artifacts.length
        ? result.artifacts
            .map((a) => `${a.type.padEnd(16)} ${a.state.padEnd(10)} ${a.title}`)
            .join("\n")
        : "(no studio artifacts)";
      emit(io, opts.json, human, result);
    });

  const sources = notebook.command("sources").description("Manage notebook sources");
  sources
    .command("list")
    .description("List sources in a notebook")
    .requiredOption("--notebook <ref>", "notebook URL or UUID")
    .option("--json", "machine-readable output", false)
    .action(async (opts: { notebook: string; json: boolean }) => {
      const profile = getProfileHint(program.opts());
      const result = await listNotebookSources({
        notebook: opts.notebook,
        ...(profile !== undefined ? { profile } : {}),
      });
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
    .option("--json", "machine-readable output", false)
    .action(async (opts: { notebook: string; source: string; json: boolean }) => {
      const profile = getProfileHint(program.opts());
      await removeNotebookSource({
        notebook: opts.notebook,
        source: opts.source,
        ...(profile !== undefined ? { profile } : {}),
      });
      emit(io, opts.json, `Removed source "${opts.source}"`, {
        notebook: opts.notebook,
        source: opts.source,
        removed: true,
      });
    });

  sources
    .command("add")
    .description("Add a source to a notebook (text content or URL)")
    .requiredOption("--notebook <ref>", "notebook URL or UUID")
    .option("--text <content>", "text content to add as a source")
    .option("--text-file <path>", 'read text source from a file ("-" for stdin)')
    .option("--url <url>", "URL to add as a source")
    .option("--json", "machine-readable output", false)
    .action(
      async (opts: {
        notebook: string;
        text?: string;
        textFile?: string;
        url?: string;
        json: boolean;
      }) => {
        const flagCount =
          (opts.url !== undefined ? 1 : 0) +
          (opts.textFile !== undefined ? 1 : 0) +
          (opts.text !== undefined ? 1 : 0);
        if (flagCount === 0) {
          throw new AichatctlError("Provide exactly one of --text, --text-file, or --url.");
        }
        if (flagCount > 1) {
          throw new AichatctlError(
            "Provide exactly one of --text, --text-file, or --url (got multiple).",
          );
        }
        const [kind, content]: ["text" | "url", string] =
          opts.url !== undefined
            ? ["url", opts.url]
            : opts.textFile !== undefined
              ? ["text", readPromptSource(opts.textFile)]
              : ["text", opts.text ?? ""];
        const profile = getProfileHint(program.opts());
        const result = await addNotebookSource({
          notebook: opts.notebook,
          kind,
          content,
          ...(profile !== undefined ? { profile } : {}),
        });
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
    .option("--json", "machine-readable output", false)
    .action(
      async (opts: {
        notebook: string;
        type: string;
        length: string;
        prompt?: string;
        promptFile?: string;
        json: boolean;
      }) => {
        const format = parseAudioFormat(opts.type);
        const length = parseAudioLength(opts.length);
        const prompt =
          opts.promptFile !== undefined ? readPromptSource(opts.promptFile) : opts.prompt;
        const profile = getProfileHint(program.opts());
        const nb = NotebookLmDriver.parseNotebookRef(opts.notebook);
        await generateNotebookPodcast({
          notebook: opts.notebook,
          audio: { format, length, ...(prompt !== undefined ? { prompt } : {}) },
          ...(profile !== undefined ? { profile } : {}),
        });
        emit(io, opts.json, `Kicked off ${format} podcast: ${nb.url}`, {
          id: nb.id,
          url: nb.url,
          format,
          length,
        });
      },
    );

  // conversation read-back ------------------------------------------------------
  const conversation = program
    .command("conversation")
    .description("Read conversations back from the web UIs");
  conversation
    .command("pull")
    .description("Fetch the latest assistant message from a conversation")
    .requiredOption("--conversation <ref>", "conversation URL or id")
    .requiredOption("--platform <platform>", "claude | chatgpt", parsePlatform)
    .option("--out <path>", "write the message text to a file instead of stdout")
    .option("--json", "machine-readable output", false)
    .action(
      async (opts: { conversation: string; platform: Platform; out?: string; json: boolean }) => {
        if (opts.platform === "gemini") {
          throw new AichatctlError("conversation pull supports only claude and chatgpt.");
        }
        const result = await pullConversation({
          platform: opts.platform,
          conversation: opts.conversation,
        });
        if (opts.out !== undefined) {
          try {
            writeFileSync(opts.out, result.text, "utf8");
          } catch (error) {
            const why = error instanceof Error ? error.message : String(error);
            throw new AichatctlError(`Could not write --out file "${opts.out}": ${why}`);
          }
        }
        const human =
          opts.out !== undefined
            ? `Wrote ${String(result.text.length)} characters to ${opts.out}`
            : result.text;
        emit(io, opts.json, human, result);
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
