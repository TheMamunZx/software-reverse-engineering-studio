import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { loadProjectConfig } from '../config/project.js';
import {
  createEvidenceEngine,
  createRepository,
  createSessionManager,
  type FindingCategory,
  type FindingSeverity,
} from '@sre-studio/core';
import { createLogger } from '@sre-studio/shared';

const logger = createLogger('evidence-command');

export function createEvidenceCommand(): Command {
  const cmd = new Command('evidence')
    .description('Query findings and evidence from an investigation')
    .argument('[sessionId]', 'Session ID')
    .option('--session <id>', 'Session ID (alternative to positional argument)')
    .option('--filter <expression>', 'Filter findings (e.g. "confidence>0.8 and category=code")')
    .option('--finding <id>', 'Show single finding with full provenance and reproducibility')
    .option('--export <path>', 'Export evidence bundle as JSON Lines (JSONL)')
    .option('--category <cat>', 'Filter by category')
    .option('--severity <sev>', 'Filter by severity')
    .option('--capability <id>', 'Filter by capability ID')
    .option('--target <id>', 'Filter by target ID')
    .option('--min-confidence <n>', 'Minimum confidence value (0.0 to 1.0)', (v) => parseFloat(v))
    .option('--limit <n>', 'Limit results count', (v) => parseInt(v, 10), 50)
    .option('--offset <n>', 'Pagination offset', (v) => parseInt(v, 10), 0)
    .option('--format <format>', 'Output format (json|table|markdown)', 'table')
    .action(async (sessionIdArg: string | undefined, options: {
      session?: string;
      filter?: string;
      finding?: string;
      export?: string;
      category?: string;
      severity?: string;
      capability?: string;
      target?: string;
      minConfidence?: number;
      limit?: number;
      offset?: number;
      format?: string;
    }) => {
      const spinner = ora('Loading evidence...').start();

      let repository;
      try {
        const projectConfig = await loadProjectConfig(process.cwd());
        if (!projectConfig) {
          spinner.fail('Not in a project directory. Run "sre-studio init" first.');
          process.exit(1);
        }

        repository = createRepository({ dbPath: projectConfig.databasePath });
        const evidenceEngine = createEvidenceEngine({ repository });
        const sessionManager = createSessionManager({
          repository,
          evidenceEngine,
          defaultResourceLimits: projectConfig.settings.resourceLimits,
        });

        // Resolve single finding by ID
        if (options.finding) {
          const finding = evidenceEngine.getFinding(options.finding);
          if (!finding) {
            spinner.fail(`Finding not found: ${options.finding}`);
            process.exit(1);
          }
          spinner.succeed(chalk.green(`Finding ${finding.id}: ${finding.title}`));

          if (options.format === 'json') {
            console.log(JSON.stringify(finding, null, 2));
          } else {
            console.log(chalk.bold(`\n${finding.title}`));
            console.log(`ID:           ${finding.id}`);
            console.log(`Severity:     ${finding.severity}`);
            console.log(`Category:     ${finding.category}`);
            console.log(`Confidence:   ${finding.confidence.level} (${finding.confidence.value}) - ${finding.confidence.justification}`);
            console.log(`Capability:   ${finding.capabilityId}`);
            console.log(`Target:       ${finding.targetId}`);
            console.log(`Created:      ${finding.createdAt}`);
            console.log(`\nObservation:  ${finding.observation}`);
            if (finding.inference) {
              console.log(`Inference:    ${finding.inference}`);
            }
            console.log(`\nProvenance:   tool=${finding.provenance.tool}, duration=${finding.provenance.duration}ms`);
            console.log(`Evidence count: ${finding.evidence.length}`);
            if (finding.evidence.length > 0) {
              for (const ev of finding.evidence) {
                console.log(`  - [${ev.type}] ${JSON.stringify(ev.location)} ${ev.excerpt ? `("${ev.excerpt}")` : ''}`);
              }
            }
          }
          return;
        }

        let sessionId = sessionIdArg ?? options.session;
        if (!sessionId) {
          const sessions = repository.listSessions();
          if (sessions.length > 0) {
            sessionId = sessions[0]?.id;
          }
        }

        if (!sessionId) {
          spinner.fail('No session found. Run "sre-studio init" or specify [sessionId]');
          process.exit(1);
        }

        const session = sessionManager.getSession(sessionId);
        if (!session) {
          spinner.fail(`Session not found: ${sessionId}`);
          process.exit(1);
        }

        // Parse optional filter expression like "confidence>0.8 and category=code"
        let categoryFilter = options.category as FindingCategory | undefined;
        let severityFilter = options.severity as FindingSeverity | undefined;
        let minConf = options.minConfidence;

        if (options.filter) {
          const expr = options.filter.toLowerCase();
          const confMatch = expr.match(/confidence\s*>\s*([0-9.]+)/);
          if (confMatch?.[1]) {
            minConf = parseFloat(confMatch[1]);
          }
          const catMatch = expr.match(/category\s*=\s*([a-z]+)/);
          if (catMatch) {
            categoryFilter = catMatch[1] as FindingCategory;
          }
          const sevMatch = expr.match(/severity\s*=\s*([a-z]+)/);
          if (sevMatch) {
            severityFilter = sevMatch[1] as FindingSeverity;
          }
        }

        const result = evidenceEngine.queryFindings({
          sessionId,
          category: categoryFilter,
          severity: severityFilter,
          confidenceMin: minConf,
          capabilityId: options.capability,
          targetId: options.target,
          limit: options.export ? 10000 : (options.limit ?? 50),
          offset: options.offset ?? 0,
        });

        // Export bundle if requested
        if (options.export) {
          const exportPath = path.resolve(options.export);
          await fs.mkdir(path.dirname(exportPath), { recursive: true });
          const jsonl = result.findings.map(f => JSON.stringify(f)).join('\n') + '\n';
          await fs.writeFile(exportPath, jsonl, 'utf8');
          spinner.succeed(chalk.green(`Exported ${result.findings.length} findings to ${exportPath}`));
          return;
        }

        spinner.succeed(chalk.green(`Found ${result.findings.length} of ${result.total} findings for session ${sessionId}`));

        const { createFormatter } = await import('../output/formatter.js');
        const formatter = createFormatter((options.format ?? 'table') as 'json' | 'table' | 'markdown');

        const outputData = result.findings.map(f => ({
          id: f.id,
          title: f.title,
          category: f.category,
          severity: f.severity,
          confidence: f.confidence.level,
          confidenceValue: f.confidence.value,
          capability: f.capabilityId,
          observation: f.observation?.slice(0, 100) + (f.observation && f.observation.length > 100 ? '...' : ''),
        }));

        console.log(formatter.format(outputData));

        if (result.hasMore) {
          console.log(chalk.yellow(`\n... ${result.total - result.findings.length - (options.offset ?? 0)} more results (use --offset to paginate)`));
        }
      } catch (error) {
        spinner.fail('Evidence query failed');
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Evidence failed');
        process.exit(1);
      } finally {
        repository?.close();
      }
    });

  // Preserve subcommands for query and stats
  cmd.addCommand(createEvidenceQuerySubcommand());
  cmd.addCommand(createEvidenceStatsSubcommand());

  return cmd;
}

function createEvidenceQuerySubcommand(): Command {
  return new Command('query')
    .description('Query findings from an investigation')
    .option('--session <id>', 'Session ID')
    .option('--category <cat>', 'Filter by category')
    .option('--severity <sev>', 'Filter by severity')
    .option('--capability <id>', 'Filter by capability')
    .option('--target <id>', 'Filter by target')
    .option('--min-confidence <n>', 'Minimum confidence (0-1)', (v) => parseFloat(v))
    .option('--limit <n>', 'Limit results', (v) => parseInt(v, 10), 50)
    .option('--offset <n>', 'Offset for pagination', (v) => parseInt(v, 10), 0)
    .option('--format <format>', 'Output format (json|table|markdown)', 'table')
    .action(async (options: {
      session?: string;
      category?: string;
      severity?: string;
      capability?: string;
      target?: string;
      minConfidence?: number;
      limit?: number;
      offset?: number;
      format?: string;
    }) => {
      const parent = createEvidenceCommand();
      await parent.parseAsync([
        ...(options.session ? [options.session] : []),
        ...(options.category ? ['--category', options.category] : []),
        ...(options.severity ? ['--severity', options.severity] : []),
        ...(options.capability ? ['--capability', options.capability] : []),
        ...(options.target ? ['--target', options.target] : []),
        ...(options.minConfidence ? ['--min-confidence', String(options.minConfidence)] : []),
        '--limit', String(options.limit ?? 50),
        '--offset', String(options.offset ?? 0),
        '--format', options.format ?? 'table',
      ], { from: 'user' });
    });
}

function createEvidenceStatsSubcommand(): Command {
  return new Command('stats')
    .description('Show evidence statistics for a session')
    .argument('[sessionId]', 'Session ID')
    .option('--session <id>', 'Session ID')
    .option('--format <format>', 'Output format (json|table|markdown)', 'table')
    .action(async (sessionIdArg: string | undefined, options: { session?: string; format?: string }) => {
      const spinner = ora('Loading statistics...').start();

      let repository;
      try {
        const projectConfig = await loadProjectConfig(process.cwd());
        if (!projectConfig) {
          spinner.fail('Not in a project directory. Run "sre-studio init" first.');
          process.exit(1);
        }

        repository = createRepository({ dbPath: projectConfig.databasePath });
        const evidenceEngine = createEvidenceEngine({ repository });

        let sessionId = sessionIdArg ?? options.session;
        if (!sessionId) {
          const sessions = repository.listSessions();
          if (sessions.length > 0) {
            sessionId = sessions[0]?.id;
          }
        }

        if (!sessionId) {
          spinner.fail('No session found. Specify [sessionId] or --session <id>');
          process.exit(1);
        }

        const stats = evidenceEngine.getSessionStatistics(sessionId);

        spinner.succeed(chalk.green(`Statistics for session ${sessionId}`));

        const { createFormatter } = await import('../output/formatter.js');
        const formatter = createFormatter((options.format ?? 'table') as 'json' | 'table' | 'markdown');

        const outputData = [
          { metric: 'Total Findings', value: Object.values(stats.findingsByCategory).reduce((a, b) => a + b, 0) },
          { metric: 'Average Confidence', value: (stats.avgConfidence * 100).toFixed(1) + '%' },
          ...Object.entries(stats.findingsByCategory).map(([cat, count]) => ({ metric: `Category: ${cat}`, value: count })),
          ...Object.entries(stats.findingsBySeverity).map(([sev, count]) => ({ metric: `Severity: ${sev}`, value: count })),
        ];

        console.log(formatter.format(outputData));
      } catch (error) {
        spinner.fail('Statistics failed');
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Evidence stats failed');
        process.exit(1);
      } finally {
        repository?.close();
      }
    });
}
