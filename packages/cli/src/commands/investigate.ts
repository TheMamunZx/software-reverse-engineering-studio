import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { loadProjectConfig } from '../config/project.js';
import {
  createRepository,
  createSessionManager,
  createEvidenceEngine,
  createInvestigationOrchestrator,
  createAuthorizationManager,
  defaultBoundaries,
} from '@sre-studio/core';
import { createCliProviderRegistry } from '../providers.js';
import { createLogger } from '@sre-studio/shared';

const logger = createLogger('investigate-command');

export type PredefinedWorkflow = 'full-binary' | 'apk-security' | 'binary-recon';

export const WORKFLOW_CAPABILITIES: Record<PredefinedWorkflow, string[]> = {
  'full-binary': [
    'binary.info',
    'binary.symbols',
    'binary.strings',
    'binary.sections',
    'binary.imports',
    'binary.exports',
  ],
  'apk-security': [
    'android.manifest',
    'android.resources',
    'android.structure',
    'android.decompilation',
    'android.components',
  ],
  'binary-recon': [
    'binary.info',
    'binary.strings',
  ],
};

export function createInvestigateCommand(): Command {
  const cmd = new Command('investigate')
    .description('Run an investigation workflow on a session')
    .argument('<sessionId>', 'Investigation session ID')
    .option('--workflow <name>', 'Predefined workflow (full-binary | apk-security | binary-recon)')
    .option('--interactive', 'Interactive investigation mode', false)
    .option('--no-interactive', 'Disable interactive prompt', true)
    .action(async (sessionId: string, options: { workflow?: string; interactive?: boolean }) => {
      const spinner = ora('Loading investigation...').start();

      let repository;
      try {
        const projectConfig = await loadProjectConfig(process.cwd());
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

        // Fail-closed authorization boundaries
        const authorizationManager = createAuthorizationManager(defaultBoundaries, sessionManager, repository);
        const orchestrator = createInvestigationOrchestrator({
          sessionManager,
          providerRegistry,
          evidenceEngine,
          authorizationManager,
        });

        const session = orchestrator.getSession(sessionId);
        if (!session) {
          spinner.fail(`Session not found: ${sessionId}`);
          process.exit(1);
        }

        if (session.targets.length === 0) {
          spinner.fail(`No targets registered in session ${sessionId}. Use "sre-studio target add" first.`);
          process.exit(1);
        }

        const primaryTargetRef = session.targets[0];
        if (!primaryTargetRef) {
          spinner.fail(`No targets registered in session ${sessionId}. Use "sre-studio target add" first.`);
          process.exit(1);
        }
        const primaryTarget = sessionManager.getTargetOrThrow(primaryTargetRef.targetId);

        if (!options.workflow) {
          // If no workflow specified, display status and available workflows
          spinner.succeed(chalk.green(`Investigation session: ${session.name} (${session.id})`));
          console.log(chalk.cyan(`  Status:   ${session.status}`));
          console.log(chalk.cyan(`  Target:   ${primaryTarget.path} (${primaryTarget.type})`));
          console.log(chalk.cyan(`  Findings: ${session.progress.findingsCount}`));
          console.log('\nAvailable workflows:');
          for (const [wfName, caps] of Object.entries(WORKFLOW_CAPABILITIES)) {
            console.log(`  - ${chalk.bold(wfName)}: ${caps.join(', ')}`);
          }
          console.log('\nRun workflow: sre-studio investigate ' + sessionId + ' --workflow <name>');
          return;
        }

        const workflowName = options.workflow as PredefinedWorkflow;
        const capabilities = WORKFLOW_CAPABILITIES[workflowName];
        if (!capabilities) {
          spinner.fail(`Unknown workflow: "${options.workflow}". Available: ${Object.keys(WORKFLOW_CAPABILITIES).join(', ')}`);
          process.exit(1);
        }

        // Authorize target and capabilities for this workflow run
        authorizationManager.updateBoundaries({
          allowedTargets: [{
            type: primaryTarget.type,
            pathPattern: primaryTarget.path,
          }],
          allowedCapabilities: capabilities.map(cap => ({ capability: cap })),
        });

        spinner.succeed(chalk.green(`Starting workflow: ${workflowName} (${capabilities.length} capabilities)`));

        let totalFindings = 0;
        for (const cap of capabilities) {
          const stepSpinner = ora(`Running ${cap}...`).start();
          try {
            const result = await orchestrator.runAnalysis({
              sessionId,
              capabilityId: cap,
              parameters: { targetPath: primaryTarget.path },
              targetId: primaryTarget.id,
            });
            totalFindings += result.findings.length;
            stepSpinner.succeed(chalk.green(`${cap}: completed (${result.findings.length} findings)`));
          } catch (err: any) {
            stepSpinner.warn(chalk.yellow(`${cap}: ${err.message}`));
          }
        }

        console.log(chalk.green(`\nWorkflow ${workflowName} completed. Total new findings: ${totalFindings}`));
        console.log(`Generate report: sre-studio report ${sessionId} --format markdown`);
      } catch (error) {
        spinner.fail('Investigation failed');
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Investigate failed');
        process.exit(1);
      } finally {
        repository?.close();
      }
    });

  return cmd;
}
