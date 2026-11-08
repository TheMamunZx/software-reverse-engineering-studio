import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { loadProjectConfig } from '../config/project.js';
import {
  createInvestigationOrchestrator,
  createEvidenceEngine,
  createAuthorizationManager,
  defaultBoundaries,
  createRepository,
  createSessionManager,
  type Finding,
} from '@sre-studio/core';
import { createCliProviderRegistry } from '../providers.js';
import { createLogger } from '@sre-studio/shared';

const logger = createLogger('analyze-command');

export function createAnalyzeCommand(): Command {
  const cmd = new Command('analyze')
    .description('Run analysis capability on a target')
    .argument('[targetId]', 'Target ID to analyze')
    .option('--capability <id>', 'Capability ID to run (e.g. binary.info, android.manifest)')
    .option('--all', 'Run all applicable capabilities for the target', false)
    .option('--session <id>', 'Session ID')
    .option('--target <id>', 'Target ID (alternative to positional argument)')
    .option('--output <path>', 'Output directory or file')
    .option('--format <format>', 'Output format (json|yaml|markdown|table)', 'table')
    .option('--param <key=value>', 'Analysis parameters', (value, previous: Record<string, unknown> = {}) => {
      const [rawKey, val = ''] = value.split('=');
      const key = rawKey ?? '';
      previous[key] = val;
      return previous;
    }, {})
    .action(async (targetIdArg: string | undefined, options: {
      capability?: string;
      all?: boolean;
      session?: string;
      target?: string;
      output?: string;
      format?: string;
      param?: Record<string, unknown>;
    }) => {
      const spinner = ora('Initializing analysis...').start();
      let repository;

      try {
        const projectDir = process.cwd();
        const projectConfig = await loadProjectConfig(projectDir);

          if (!projectConfig) {
            spinner.fail('Not in a project directory. Run "sre-studio init" first.');
            process.exit(1);
          }

          repository = createRepository({ dbPath: projectConfig.databasePath });
          const providerRegistry = createCliProviderRegistry();
          const evidenceEngine = createEvidenceEngine({ repository });
          const sessionManager = createSessionManager({
            repository,
            evidenceEngine,
            defaultResourceLimits: projectConfig.settings.resourceLimits,
          });

        // Determine session
        let sessionId = options.session;
        if (!sessionId) {
          const sessions = repository.listSessions();
          if (sessions.length > 0) {
            sessionId = sessions[0]?.id;
          }
        }

        if (!sessionId) {
          spinner.fail('No session found. Run "sre-studio init" or specify --session <id>');
          process.exit(1);
        }

        const session = sessionManager.getSession(sessionId);
        if (!session) {
          spinner.fail(`Session not found: ${sessionId}`);
          process.exit(1);
        }

        // Determine target
        const targetId = targetIdArg ?? options.target ?? session.targets[0]?.targetId;
        if (!targetId) {
          spinner.fail('No target specified and no targets found in session. Use "sre-studio target add" first.');
          process.exit(1);
        }

        const target = sessionManager.getTarget(targetId);
        if (!target) {
          spinner.fail(`Target not found: ${targetId}`);
          process.exit(1);
        }

        // Determine capabilities to run
        let capabilitiesToRun: string[] = [];
        if (options.all) {
          const allCaps = providerRegistry.listCapabilities();
          // Filter by target type: binary capabilities start with binary., android capabilities start with android.
          capabilitiesToRun = allCaps
            .map(c => c.id)
            .filter(id => target.type === 'android' ? id.startsWith('android.') : id.startsWith('binary.'));
        } else if (options.capability) {
          capabilitiesToRun = [options.capability];
        } else {
          spinner.fail('Please specify a capability with --capability <id> or run all with --all');
          process.exit(1);
        }

        // Fail-closed: explicitly authorize target and capabilities for this analysis run
        const authorizationManager = createAuthorizationManager(defaultBoundaries, sessionManager, repository);
        authorizationManager.updateBoundaries({
          allowedTargets: [{
            type: target.type,
            pathPattern: target.path,
          }],
          allowedCapabilities: capabilitiesToRun.map(cap => ({ capability: cap })),
        });

        const orchestrator = createInvestigationOrchestrator({
          sessionManager,
          providerRegistry,
          evidenceEngine,
          authorizationManager,
        });

        spinner.succeed(chalk.green(`Analyzing target ${target.path} (${target.type})`));

        const allFindings: Finding[] = [];
        for (const capId of capabilitiesToRun) {
          const stepSpinner = ora(`Running ${capId}...`).start();
          try {
            const result = await orchestrator.runAnalysis({
              sessionId,
              capabilityId: capId,
              parameters: { targetPath: target.path, ...(options.param ?? {}) },
              targetId: target.id,
            });
            allFindings.push(...result.findings);
            stepSpinner.succeed(chalk.green(`${capId}: completed (${result.findings.length} findings)`));
          } catch (err: any) {
            stepSpinner.warn(chalk.yellow(`${capId}: ${err.message}`));
          }
        }

        console.log(chalk.green(`\nTotal findings generated: ${allFindings.length}`));

        const { createFormatter } = await import('../output/formatter.js');
        const formatter = createFormatter((options.format ?? 'table') as 'json' | 'table' | 'markdown' | 'yaml');

        const outputData = allFindings.map(f => ({
          id: f.id,
          title: f.title,
          category: f.category,
          severity: f.severity,
          confidence: f.confidence.level,
          observation: f.observation?.slice(0, 100) + (f.observation && f.observation.length > 100 ? '...' : ''),
        }));

        const formatted = formatter.format(outputData);

        if (options.output) {
          const outPath = path.resolve(options.output);
          await fs.mkdir(path.dirname(outPath), { recursive: true });
          await fs.writeFile(outPath, formatted, 'utf8');
          console.log(chalk.green(`Results written to ${outPath}`));
        } else {
          console.log(formatted);
        }
      } catch (error) {
        spinner.fail('Analysis failed');
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Analyze failed');
        process.exit(1);
      } finally {
        repository?.close();
      }
    });

  return cmd;
}
