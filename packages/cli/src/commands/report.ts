import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import path from 'node:path';
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
  type Finding,
  type InvestigationSession,
} from '@sre-studio/core';
import { createCliProviderRegistry } from '../providers.js';
import { createLogger } from '@sre-studio/shared';

const logger = createLogger('report-command');

export type ReportFormat = 'markdown' | 'html' | 'json' | 'sarif';
export type ReportTemplate = 'technical' | 'executive' | 'compliance';

export interface ReportOptions {
  format?: ReportFormat;
  template?: ReportTemplate;
  output?: string;
  includeEvidence?: boolean;
  confidenceThreshold?: number;
}

export function generateMarkdownReport(
  session: InvestigationSession,
  findings: Finding[],
  stats: { findingsByCategory: Record<string, number>; findingsBySeverity: Record<string, number>; avgConfidence: number },
  template: ReportTemplate,
  includeEvidence = false,
): string {
  const lines: string[] = [];
  lines.push(`# SRE Studio Investigation Report: ${session.name}`);
  lines.push('');
  lines.push(`- **Session ID**: \`${session.id}\``);
  lines.push(`- **Status**: \`${session.status}\``);
  lines.push(`- **Template**: \`${template}\``);
  lines.push(`- **Created By**: ${session.createdBy}`);
  lines.push(`- **Date**: ${session.createdAt}`);
  lines.push(`- **Average Confidence**: ${(stats.avgConfidence * 100).toFixed(1)}%`);
  lines.push('');

  lines.push('## Executive Summary');
  lines.push('');
  lines.push(`Investigation \`${session.id}\` completed with **${findings.length}** findings.`);
  lines.push('');

  lines.push('### Findings by Severity');
  lines.push('| Severity | Count |');
  lines.push('|----------|-------|');
  for (const [sev, count] of Object.entries(stats.findingsBySeverity)) {
    lines.push(`| ${sev} | ${count} |`);
  }
  lines.push('');

  lines.push('### Findings by Category');
  lines.push('| Category | Count |');
  lines.push('|----------|-------|');
  for (const [cat, count] of Object.entries(stats.findingsByCategory)) {
    lines.push(`| ${cat} | ${count} |`);
  }
  lines.push('');

  lines.push('## Findings Detail');
  lines.push('');
  if (findings.length === 0) {
    lines.push('No findings recorded for this session.');
  } else {
    for (const f of findings) {
      lines.push(`### [${f.severity.toUpperCase()}] ${f.title}`);
      lines.push(`- **ID**: \`${f.id}\``);
      lines.push(`- **Category**: \`${f.category}\` | **Confidence**: ${f.confidence.level} (${(f.confidence.value * 100).toFixed(0)}%)`);
      lines.push(`- **Justification**: ${f.confidence.justification}`);
      lines.push('');
      lines.push(`**Observation**: ${f.observation}`);
      if (f.inference) {
        lines.push('');
        lines.push(`**Inference**: ${f.inference}`);
      }
      if (includeEvidence && f.evidence.length > 0) {
        lines.push('');
        lines.push('**Evidence**:');
        for (const ev of f.evidence) {
          lines.push(`  - Type: \`${ev.type}\` | Location: \`${JSON.stringify(ev.location)}\``);
          if (ev.excerpt) {
            lines.push(`    Excerpt: \`${ev.excerpt}\``);
          }
        }
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

export function generateHtmlReport(
  session: InvestigationSession,
  findings: Finding[],
  stats: { findingsByCategory: Record<string, number>; findingsBySeverity: Record<string, number>; avgConfidence: number },
  template: ReportTemplate,
  includeEvidence = false,
): string {
  const md = generateMarkdownReport(session, findings, stats, template, includeEvidence);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>SRE Studio Report - ${session.name}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; max-width: 900px; margin: 0 auto; padding: 2rem; color: #333; }
    h1, h2, h3 { color: #111; }
    table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
    th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
    th { background: #f5f5f5; }
    code { background: #f0f0f0; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
    pre { background: #f8f8f8; padding: 1rem; border-radius: 4px; overflow-x: auto; }
  </style>
</head>
<body>
  <pre>${md.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
</body>
</html>`;
}

export function generateSarifReport(
  session: InvestigationSession,
  findings: Finding[],
): Record<string, unknown> {
  return {
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'sre-studio',
            version: '0.1.0',
            informationUri: 'https://github.com/TheMamunZx/software-reverse-engineering-studio',
            rules: findings.map(f => ({
              id: f.capabilityId,
              name: f.title,
              shortDescription: { text: f.title },
              fullDescription: { text: f.observation },
              defaultConfiguration: {
                level: f.severity === 'critical' || f.severity === 'high' ? 'error' : f.severity === 'medium' ? 'warning' : 'note',
              },
            })),
          },
        },
        results: findings.map(f => ({
          ruleId: f.capabilityId,
          level: f.severity === 'critical' || f.severity === 'high' ? 'error' : f.severity === 'medium' ? 'warning' : 'note',
          message: { text: f.observation },
          locations: f.evidence.map(ev => ({
            physicalLocation: {
              artifactLocation: { uri: ev.location.file ?? 'unknown' },
              region: {
                startLine: ev.location.line ?? 1,
                startColumn: ev.location.column ?? 1,
              },
            },
          })),
        })),
      },
    ],
  };
}

export function createReportCommand(): Command {
  const cmd = new Command('report')
    .description('Generate an investigation report')
    .argument('<sessionId>', 'Investigation session ID')
    .option('--format <format>', 'Report format (markdown|html|json|sarif)', 'markdown')
    .option('--template <name>', 'Report template (technical|executive|compliance)', 'technical')
    .option('--output <path>', 'Output file path (default: stdout)')
    .option('--include-evidence', 'Embed full evidence details', false)
    .option('--confidence-threshold <n>', 'Minimum confidence threshold (0.0 to 1.0)', (v) => parseFloat(v))
    .action(async (sessionId: string, options: ReportOptions) => {
      const spinner = ora('Generating report...').start();

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

        const stats = evidenceEngine.getSessionStatistics(sessionId);
        let findings = evidenceEngine.queryFindings({
          sessionId,
          confidenceMin: options.confidenceThreshold,
          limit: 1000,
        }).findings;

        spinner.succeed(chalk.green(`Report generated for session ${sessionId}`));

        const format = options.format ?? 'markdown';
        const template = options.template ?? 'technical';
        let rendered = '';

        switch (format) {
          case 'json':
            rendered = JSON.stringify({ session, statistics: stats, findings }, null, 2) + '\n';
            break;
          case 'sarif':
            rendered = JSON.stringify(generateSarifReport(session, findings), null, 2) + '\n';
            break;
          case 'html':
            rendered = generateHtmlReport(session, findings, stats, template, options.includeEvidence) + '\n';
            break;
          case 'markdown':
          default:
            rendered = generateMarkdownReport(session, findings, stats, template, options.includeEvidence) + '\n';
            break;
        }

        if (options.output) {
          const outPath = path.resolve(options.output);
          await fs.mkdir(path.dirname(outPath), { recursive: true });
          await fs.writeFile(outPath, rendered, 'utf8');
          console.log(chalk.green(`Report written to ${outPath}`));
        } else {
          process.stdout.write(rendered);
        }
      } catch (error) {
        spinner.fail('Report generation failed');
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Report failed');
        process.exit(1);
      } finally {
        repository?.close();
      }
    });

  return cmd;
}
