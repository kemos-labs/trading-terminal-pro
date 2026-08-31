#!/usr/bin/env node
/**
 * Frontend-network → Fastify-runtime route parity gate.
 *
 * - Routes are captured from Fastify's onRoute hook after every plugin is ready.
 * - TypeScript's parser finds real fetch/EventSource calls (not comments).
 * - Literal/template URLs are evaluated with placeholders.
 * - A dynamic URL must declare its finite route set on the preceding line:
 *     // route-parity: /api/example/:id | /docs/*
 *
 * The annotation is local evidence for an otherwise unprovable dynamic call; it
 * is never the backend route authority.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { buildServer } from '../server/app.js';
import { compileRuntimeRoutes, parsePattern, resolves as resolveEntry } from './route-parity-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'src');

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (!['node_modules', 'test', '__tests__'].includes(entry)) walk(path, files);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      files.push(path);
    }
  }
  return files;
}

const fastify = await buildServer();
try {
  await fastify.ready();
  const runtimeRoutes = fastify.runtimeRouteManifest
    .filter((route) => route.url.startsWith('/api') || route.url.startsWith('/docs'));
  const runtimePatterns = [...new Set(runtimeRoutes.map((route) => route.url))].sort();
  // Method-aware: one compiled entry per (method, path) pair.
  const compiled = compileRuntimeRoutes(runtimeRoutes);

  function resolves(pattern, method) {
    return resolveEntry(compiled, pattern, method);
  }

  const errors = [];
  const calls = [];

  for (const file of walk(srcDir)) {
    const text = readFileSync(file, 'utf8');
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const constants = new Map();

    function collect(node) {
      if (
        ts.isVariableDeclaration(node)
        && ts.isIdentifier(node.name)
        && node.initializer
      ) {
        constants.set(node.name.text, node.initializer);
      }
      ts.forEachChild(node, collect);
    }
    collect(source);

    function evaluate(node, seen = new Set()) {
      if (!node) return null;
      if (ts.isStringLiteralLike(node)) return node.text;
      if (ts.isParenthesizedExpression(node)) return evaluate(node.expression, seen);
      if (ts.isIdentifier(node)) {
        if (seen.has(node.text)) return null;
        const initializer = constants.get(node.text);
        if (!initializer) return null;
        return evaluate(initializer, new Set([...seen, node.text]));
      }
      if (ts.isTemplateExpression(node)) {
        let value = node.head.text;
        for (const span of node.templateSpans) {
          value += evaluate(span.expression, seen) ?? `\${${span.expression.getText(source)}}`;
          value += span.literal.text;
        }
        return value;
      }
      if (
        ts.isBinaryExpression(node)
        && node.operatorToken.kind === ts.SyntaxKind.PlusToken
      ) {
        const left = evaluate(node.left, seen);
        const right = evaluate(node.right, seen);
        if (left == null && right == null) return null;
        return `${left ?? `\${${node.left.getText(source)}}`}${right ?? `\${${node.right.getText(source)}}`}`;
      }
      return null;
    }

    function annotationsFor(node) {
      const start = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
      const lines = text.split(/\r?\n/);
      const window = lines.slice(Math.max(0, start - 2), start + 1).join('\n');
      const match = window.match(/route-parity:\s*([^\n]+)/);
      return match
        ? match[1].split('|').map((value) => value.trim()).filter(Boolean)
        : [];
    }

    /** Parse the fetch options argument to extract the HTTP method (default GET). */
    function optionsMethod(node) {
      if (!node) return 'GET';
      const arg = node.arguments?.[1];
      if (!arg) return 'GET';
      let method = null;
      for (const prop of arg.properties ?? []) {
        if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === 'method') {
          const v = evaluate(prop.initializer);
          if (typeof v === 'string' && /^(GET|POST|PUT|PATCH|DELETE|HEAD)$/i.test(v)) method = v.toUpperCase();
        }
      }
      return method ?? 'GET';
    }

    function inspect(node) {
      const isFetch = ts.isCallExpression(node)
        && ts.isIdentifier(node.expression)
        && node.expression.text === 'fetch';
      const isEventSource = ts.isNewExpression(node)
        && ts.isIdentifier(node.expression)
        && node.expression.text === 'EventSource';

      if (isFetch || isEventSource) {
        const argument = node.arguments?.[0];
        const evaluated = evaluate(argument);
        // EventSource is always a GET; fetch defaults to GET unless options say otherwise.
        const method = isEventSource ? 'GET' : optionsMethod(node);
        const annotations = annotationsFor(node);
        const patterns = annotations.length > 0
          ? annotations
          : evaluated?.startsWith('/api') || evaluated?.startsWith('/docs')
            ? [evaluated]
            : [];
        const location = source.getLineAndCharacterOfPosition(node.getStart(source));
        const label = `${relative(root, file)}:${location.line + 1}`;

        if (patterns.length === 0) {
          errors.push(`${label}: dynamic network URL requires a route-parity annotation`);
        } else {
          for (const pattern of patterns) {
            const { method: patMethod, path } = parsePattern(pattern);
            const callMethod = method ?? patMethod;
            calls.push({ label, method: callMethod, pattern: path });
            if (!resolves(path, callMethod)) {
              errors.push(`${label}: ${callMethod} ${path} has no matching Fastify runtime route (method-aware)`);
            }
          }
        }
      }
      ts.forEachChild(node, inspect);
    }
    inspect(source);
  }

  if (errors.length > 0) {
    console.error(`Route parity FAIL (${errors.length} issue${errors.length === 1 ? '' : 's'}):`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exitCode = 1;
  } else {
    console.log(`Route parity PASS: ${calls.length} frontend route declarations resolve against ${runtimePatterns.length} Fastify runtime patterns.`);
  }

  const sortedRuntimeRoutes = runtimeRoutes
    .sort((a, b) => a.url.localeCompare(b.url) || a.method.localeCompare(b.method));

  if (process.argv.includes('--list')) {
    for (const route of sortedRuntimeRoutes) {
      console.log(`${route.method.padEnd(7)} ${route.url}`);
    }
  }

  if (process.argv.includes('--write') && errors.length === 0) {
    const operations = sortedRuntimeRoutes.filter((route) => !['HEAD', 'OPTIONS'].includes(route.method));
    const classification = (route) => {
      if (route.url === '/api/stripe/webhook') return 'webhook';
      if (route.url.startsWith('/api/auth/')) {
        return route.url === '/api/auth/me' || route.url === '/api/auth/logout'
          ? 'authenticated'
          : 'credential-public';
      }
      if (route.url.startsWith('/api/billing/')) return 'authenticated / entitlement';
      if (route.url.startsWith('/api/ksa/')) return 'conditionally entitled';
      if (route.url.startsWith('/docs/')) return 'static allowlist';
      if (route.url === '/api/health' || route.url === '/api/cache/status') return 'health / operations';
      return 'public server-proxied';
    };
    const lines = [
      '# Runtime route inventory',
      '',
      'Generated deterministically by `node scripts/route-parity.mjs --write` from Fastify\'s `onRoute` hook after all plugins are ready.',
      '',
      `- Runtime path patterns: **${runtimePatterns.length}**`,
      `- Non-HEAD/OPTIONS operations: **${operations.length}**`,
      `- Frontend route declarations checked: **${calls.length}**`,
      '- Unregistered `/api` and `/docs` requests fail with JSON 404 responses.',
      '',
      '| Method | Runtime path | Classification |',
      '|---|---|---|',
      ...operations.map((route) => `| ${route.method} | \`${route.url}\` | ${classification(route)} |`),
      '',
      '## Gate semantics',
      '',
      '- Backend inventory is runtime-discovered; this document is not a route authority.',
      '- Frontend literal/template network calls are parsed with the TypeScript AST.',
      '- A dynamic URL must declare its finite expected route patterns in an adjacent `route-parity:` annotation, each of which is matched against the runtime table.',
      '- Route existence does not prove response-contract completeness; OpenAPI/schema validation is a separate gate.',
      '',
    ];
    const destination = join(root, 'docs', 'engineering', 'ROUTE_INVENTORY.md');
    writeFileSync(destination, lines.join('\n'));
    console.log(`Runtime route inventory → ${relative(root, destination)}`);
  }
} finally {
  await fastify.close();
}
