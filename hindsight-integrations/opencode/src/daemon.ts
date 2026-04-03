import { platform } from "os";
import type { HindsightConfig } from "./config";
import { debugLog } from "./config";
import { HindsightClient } from "./client";

const PROFILE_NAME = "opencode";

function detectLlmEnv(config: HindsightConfig): Record<string, string> {
  const env: Record<string, string> = {};

  if (config.llmProvider) {
    env.HINDSIGHT_API_LLM_PROVIDER = config.llmProvider;
  }
  if (config.llmModel) {
    env.HINDSIGHT_API_LLM_MODEL = config.llmModel;
  }

  const provider = config.llmProvider;
  if (provider === "openai" || (!provider && process.env.OPENAI_API_KEY)) {
    env.HINDSIGHT_API_LLM_PROVIDER = env.HINDSIGHT_API_LLM_PROVIDER || "openai";
    env.HINDSIGHT_API_LLM_API_KEY = process.env.OPENAI_API_KEY || "";
  } else if (provider === "anthropic" || (!provider && process.env.ANTHROPIC_API_KEY)) {
    env.HINDSIGHT_API_LLM_PROVIDER = env.HINDSIGHT_API_LLM_PROVIDER || "anthropic";
    env.HINDSIGHT_API_LLM_API_KEY = process.env.ANTHROPIC_API_KEY || "";
  } else if (provider === "gemini" || (!provider && process.env.GEMINI_API_KEY)) {
    env.HINDSIGHT_API_LLM_PROVIDER = env.HINDSIGHT_API_LLM_PROVIDER || "gemini";
    env.HINDSIGHT_API_LLM_API_KEY = process.env.GEMINI_API_KEY || "";
  } else if (provider === "groq" || (!provider && process.env.GROQ_API_KEY)) {
    env.HINDSIGHT_API_LLM_PROVIDER = env.HINDSIGHT_API_LLM_PROVIDER || "groq";
    env.HINDSIGHT_API_LLM_API_KEY = process.env.GROQ_API_KEY || "";
  }

  if (platform() === "darwin") {
    env.HINDSIGHT_API_EMBEDDINGS_LOCAL_FORCE_CPU = "1";
    env.HINDSIGHT_API_RERANKER_LOCAL_FORCE_CPU = "1";
  }

  return env;
}

function getEmbedCommand(config: HindsightConfig): string[] {
  if (config.embedPackagePath) {
    return ["uv", "run", "--directory", config.embedPackagePath, "hindsight-embed"];
  }
  const version = config.embedVersion || "latest";
  return ["uvx", `hindsight-embed@${version}`];
}

async function runCommand(
  args: string[],
  env?: Record<string, string>,
  timeoutMs = 30000,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(args, {
      env: { ...process.env, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to launch "${args[0]}". Is it installed and on PATH? (${msg})`,
    );
  }

  let killed = false;
  const timer = setTimeout(() => {
    killed = true;
    proc.kill();
    setTimeout(() => proc.kill(9), 3000);
  }, timeoutMs);

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await Promise.race([
    proc.exited,
    new Promise<number>((_, reject) =>
      setTimeout(() => reject(new Error("Process did not exit after kill")), timeoutMs + 5000),
    ),
  ]);
  clearTimeout(timer);

  if (killed) {
    throw new Error(`Command timed out after ${timeoutMs}ms: ${args.join(" ")}`);
  }

  return { exitCode, stdout: stdout.trim(), stderr: stderr.trim() };
}

export async function resolveApiUrl(
  config: HindsightConfig,
  allowDaemonStart = false,
): Promise<string | null> {
  if (config.hindsightApiUrl) {
    debugLog(config, `Using external API: ${config.hindsightApiUrl}`);
    return config.hindsightApiUrl;
  }

  const baseUrl = `http://127.0.0.1:${config.apiPort}`;
  const client = new HindsightClient(baseUrl);
  if (await client.healthy()) {
    debugLog(config, `Existing server healthy on port ${config.apiPort}`);
    return baseUrl;
  }

  if (!allowDaemonStart) {
    debugLog(config, `No server on port ${config.apiPort}, daemon start not allowed in this hook`);
    return null;
  }

  debugLog(config, `No server on port ${config.apiPort}, attempting daemon start`);

  try {
    await startDaemon(config);
    return baseUrl;
  } catch (err) {
    debugLog(config, `Daemon start failed: ${err}`);
    return null;
  }
}

async function startDaemon(config: HindsightConfig): Promise<void> {
  const llmEnv = detectLlmEnv(config);
  const noKeyProviders = ["ollama", "lmstudio", "claude-code", "openai-codex"];
  if (!llmEnv.HINDSIGHT_API_LLM_API_KEY && !noKeyProviders.includes(llmEnv.HINDSIGHT_API_LLM_PROVIDER || "")) {
    throw new Error(
      "No LLM API key found. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or configure llmProvider in ~/.hindsight/opencode.json",
    );
  }

  const baseCmd = getEmbedCommand(config);

  const envFlags: string[] = [];
  const idleTimeout = config.daemonIdleTimeout || 300;
  const allEnv = {
    ...llmEnv,
    HINDSIGHT_EMBED_DAEMON_IDLE_TIMEOUT: String(idleTimeout),
  };
  for (const [key, value] of Object.entries(allEnv)) {
    if (value) {
      envFlags.push("--env", `${key}=${value}`);
    }
  }

  const profileArgs = [
    ...baseCmd,
    "profile", "create", PROFILE_NAME,
    "--merge",
    "--port", String(config.apiPort),
    ...envFlags,
  ];

  debugLog(config, `Configuring profile: ${profileArgs[0]} ... (${profileArgs.length} args)`);
  const profileResult = await runCommand(profileArgs, allEnv, 10000);
  if (profileResult.exitCode !== 0) {
    throw new Error(`Profile create failed (exit ${profileResult.exitCode}): ${profileResult.stderr}`);
  }

  const daemonArgs = [...baseCmd, "daemon", "--profile", PROFILE_NAME, "start"];
  debugLog(config, "Starting daemon...");
  const daemonResult = await runCommand(daemonArgs, allEnv, 30000);
  if (daemonResult.exitCode !== 0 && !daemonResult.stderr.toLowerCase().includes("already running")) {
    throw new Error(`Daemon start failed (exit ${daemonResult.exitCode}): ${daemonResult.stderr}`);
  }

  const client = new HindsightClient(`http://127.0.0.1:${config.apiPort}`);
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await client.healthy()) {
      debugLog(config, `Daemon ready after ${attempt + 1} attempts`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error("Daemon failed to become ready within 30 seconds");
}

export async function stopDaemon(config: HindsightConfig): Promise<void> {
  if (config.hindsightApiUrl) return;

  const baseCmd = getEmbedCommand(config);
  const stopArgs = [...baseCmd, "daemon", "--profile", PROFILE_NAME, "stop"];

  try {
    await runCommand(stopArgs, undefined, 10000);
    debugLog(config, "Daemon stopped");
  } catch (err) {
    debugLog(config, `Daemon stop error: ${err}`);
  }
}
