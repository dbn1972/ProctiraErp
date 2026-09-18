import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function readEvent() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    process.stderr.write('Kiro safety hook could not parse the PreToolUse event.\n');
    process.exit(2);
  }
}

function requestConfirmation(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        permissionDecision: 'ask',
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

function extractParenthesized(source, openIndex) {
  let depth = 1;
  let quote = '';
  for (let index = openIndex + 1; index < source.length; index += 1) {
    const character = source[index];
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (quote) {
      if (character === quote) quote = '';
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
    } else if (character === '(') {
      depth += 1;
    } else if (character === ')') {
      depth -= 1;
      if (depth === 0) return { content: source.slice(openIndex + 1, index), end: index };
    }
  }
  return undefined;
}

function extractBackticks(source, openIndex) {
  for (let index = openIndex + 1; index < source.length; index += 1) {
    if (source[index] === '\\') {
      index += 1;
    } else if (source[index] === '`') {
      return { content: source.slice(openIndex + 1, index), end: index };
    }
  }
  return undefined;
}

function parseShellCommands(source) {
  const commands = [];
  let tokens = [];
  let token = '';
  let tokenStarted = false;
  let quote = '';
  let ambiguous = false;

  const flushToken = () => {
    if (tokenStarted) tokens.push(token);
    token = '';
    tokenStarted = false;
  };
  const flushCommand = () => {
    flushToken();
    if (tokens.length > 0) commands.push(tokens);
    tokens = [];
  };
  const appendSubstitution = (extracted, arithmetic = false) => {
    if (!extracted) {
      ambiguous = true;
      return undefined;
    }
    if (!arithmetic) {
      const nested = parseShellCommands(extracted.content);
      commands.push(...nested.commands);
      ambiguous ||= nested.ambiguous;
    }
    token += '__dynamic__';
    tokenStarted = true;
    return extracted.end;
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (quote === "'") {
      if (character === "'") quote = '';
      else token += character;
      tokenStarted = true;
      continue;
    }

    if (quote === '"') {
      if (character === '"') {
        quote = '';
      } else if (character === '\\') {
        index += 1;
        if (index < source.length) token += source[index];
        else ambiguous = true;
      } else if (character === '$' && source[index + 1] === '(') {
        const arithmetic = source[index + 2] === '(';
        const end = appendSubstitution(
          extractParenthesized(source, arithmetic ? index + 2 : index + 1),
          arithmetic,
        );
        if (end === undefined) break;
        index = end;
      } else if (character === '`') {
        const extracted = extractBackticks(source, index);
        const end = appendSubstitution(extracted);
        if (end === undefined) break;
        index = end;
      } else {
        token += character;
      }
      tokenStarted = true;
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      tokenStarted = true;
    } else if (character === '\\') {
      index += 1;
      if (index < source.length) {
        token += source[index];
        tokenStarted = true;
      } else {
        ambiguous = true;
      }
    } else if (character === '$' && source[index + 1] === '(') {
      const arithmetic = source[index + 2] === '(';
      const end = appendSubstitution(
        extractParenthesized(source, arithmetic ? index + 2 : index + 1),
        arithmetic,
      );
      if (end === undefined) break;
      index = end;
    } else if ((character === '<' || character === '>') && source[index + 1] === '(') {
      const end = appendSubstitution(extractParenthesized(source, index + 1));
      if (end === undefined) break;
      index = end;
    } else if (character === '`') {
      const extracted = extractBackticks(source, index);
      const end = appendSubstitution(extracted);
      if (end === undefined) break;
      index = end;
    } else if (character === '#' && !tokenStarted) {
      while (index < source.length && source[index] !== '\n') index += 1;
      flushCommand();
    } else if (/\s/.test(character)) {
      flushToken();
      if (character === '\n') flushCommand();
    } else if (';&|(){}'.includes(character)) {
      flushCommand();
      if ((character === '&' || character === '|') && source[index + 1] === character) index += 1;
    } else {
      token += character;
      tokenStarted = true;
    }
  }

  flushCommand();
  if (quote) ambiguous = true;
  return { commands, ambiguous };
}

function stripLeadingOptions(tokens, optionsWithValue = new Set()) {
  let index = 0;
  while (index < tokens.length && tokens[index].startsWith('-')) {
    const option = tokens[index];
    index += 1;
    if (optionsWithValue.has(option) && index < tokens.length) index += 1;
  }
  return tokens.slice(index);
}

function unwrapCommand(tokens) {
  let command = [...tokens];
  for (let pass = 0; pass < 6 && command.length > 0; pass += 1) {
    while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(command[0])) command.shift();
    const executable = basename(command[0] ?? '');
    if (executable === 'sudo') {
      command = stripLeadingOptions(
        command.slice(1),
        new Set([
          '-u',
          '--user',
          '-g',
          '--group',
          '-h',
          '--host',
          '-p',
          '--prompt',
          '-C',
          '--chdir',
        ]),
      );
    } else if (executable === 'env') {
      command = stripLeadingOptions(command.slice(1), new Set(['-u', '--unset', '-C', '--chdir']));
    } else if (['command', 'builtin', 'nohup', 'time'].includes(executable)) {
      command = stripLeadingOptions(command.slice(1));
    } else if (executable === 'pnpm') {
      const execIndex = command.findIndex((token, index) => index > 0 && token === 'exec');
      if (execIndex === -1) break;
      command = stripLeadingOptions(command.slice(execIndex + 1));
    } else if (executable === 'npx') {
      command = stripLeadingOptions(command.slice(1), new Set(['-p', '--package', '-c', '--call']));
    } else {
      break;
    }
  }
  return command;
}

function hasShortFlag(argument, flag) {
  return /^-[^-]+$/.test(argument) && argument.slice(1).includes(flag);
}

function currentBranch(cwd) {
  const result = spawnSync('git', ['branch', '--show-current'], {
    cwd,
    encoding: 'utf8',
    shell: false,
    timeout: 2_000,
  });
  return result.status === 0 ? result.stdout.trim() : '';
}

function gitInvocation(tokens, eventCwd) {
  let index = 1;
  let cwd = eventCwd;
  const optionsWithValue = new Set([
    '-C',
    '-c',
    '--git-dir',
    '--work-tree',
    '--namespace',
    '--config-env',
    '--exec-path',
  ]);
  while (index < tokens.length && tokens[index].startsWith('-')) {
    const option = tokens[index];
    const value = tokens[index + 1];
    if (option === '-C' && value) cwd = resolve(cwd, value);
    if (option.startsWith('-C') && option.length > 2) cwd = resolve(cwd, option.slice(2));
    index += optionsWithValue.has(option) ? 2 : 1;
  }
  return { subcommand: tokens[index], args: tokens.slice(index + 1), cwd };
}

function isProtectedBranch(branch) {
  return /^(?:main|master|develop|release(?:\/|$))/i.test(branch);
}

function pushTargetsProtectedBranch(args, cwd) {
  const optionsWithValue = new Set(['--repo', '--receive-pack', '--exec', '--push-option', '-o']);
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (optionsWithValue.has(argument)) index += 1;
    else if (!argument.startsWith('-')) positional.push(argument);
  }

  const refs = positional.slice(1);
  const branch = currentBranch(cwd);
  if (refs.length === 0) return !branch || isProtectedBranch(branch);

  return refs.some((ref) => {
    const normalized = ref.replace(/^\+/, '');
    if (/^HEAD$/i.test(normalized)) return !branch || isProtectedBranch(branch);
    const target = normalized.includes(':')
      ? normalized.slice(normalized.indexOf(':') + 1)
      : normalized;
    return isProtectedBranch(target.replace(/^refs\/heads\//i, ''));
  });
}

function analyzeCommand(rawTokens, eventCwd) {
  const tokens = unwrapCommand(rawTokens);
  if (tokens.length === 0) return undefined;
  const executable = basename(tokens[0]);
  const args = tokens.slice(1);

  if (executable.includes('$') || executable.includes('__dynamic__')) {
    return 'the executable is dynamically constructed and cannot be safely inspected';
  }
  if (['bash', 'sh', 'dash', 'zsh', 'ksh'].includes(executable) && args.includes('-c')) {
    const command = args[args.indexOf('-c') + 1];
    if (typeof command !== 'string') return 'a shell command string could not be inspected';
    return analyzeShell(command, eventCwd);
  }
  if (executable === 'eval') return analyzeShell(args.join(' '), eventCwd);

  if (executable === 'rm') {
    if (args.includes('__dynamic__'))
      return 'rm uses dynamic arguments that cannot be safely inspected';
    const recursive = args.some((arg) => arg === '--recursive' || hasShortFlag(arg, 'r'));
    const forced = args.some((arg) => arg === '--force' || hasShortFlag(arg, 'f'));
    if (recursive && forced)
      return 'recursive forced deletion can remove uncommitted work or local data';
  }

  if (executable === 'git') {
    const { subcommand, args: gitArgs, cwd } = gitInvocation(tokens, eventCwd);
    if (gitArgs.includes('__dynamic__'))
      return 'Git uses dynamic arguments that cannot be safely inspected';
    if (subcommand === 'reset' && gitArgs.includes('--hard'))
      return 'git hard reset discards uncommitted work';
    if (
      subcommand === 'clean' &&
      gitArgs.some((arg) => arg === '--force' || hasShortFlag(arg, 'f'))
    ) {
      return 'forced git clean removes untracked files';
    }
    if (subcommand === 'branch' && gitArgs.some((arg) => arg === '-D' || hasShortFlag(arg, 'D'))) {
      return 'forced branch deletion can discard unmerged work';
    }
    const commitProducingCommands = new Set([
      'commit',
      'merge',
      'cherry-pick',
      'revert',
      'rebase',
      'am',
      'pull',
    ]);
    const recoveryOnly = gitArgs.includes('--abort') || gitArgs.includes('--quit');
    const fastForwardUpdate = subcommand === 'pull' && gitArgs.includes('--ff-only');
    if (commitProducingCommands.has(subcommand) && !recoveryOnly && !fastForwardUpdate) {
      const branch = currentBranch(cwd);
      if (!branch || isProtectedBranch(branch)) {
        return 'creating or rewriting commits on a protected or unknown branch bypasses the task-branch workflow';
      }
    }
    if (subcommand === 'push') {
      const forced = gitArgs.some(
        (arg) =>
          arg === '--force' ||
          arg === '--force-with-lease' ||
          arg.startsWith('--force-with-lease=') ||
          arg === '--force-if-includes' ||
          hasShortFlag(arg, 'f') ||
          arg.startsWith('+'),
      );
      if (forced) {
        return 'force push can rewrite shared history';
      }
      const bulk = gitArgs.some(
        (arg) => arg === '--all' || arg === '--mirror' || arg.includes('*'),
      );
      if (bulk) {
        return 'bulk or wildcard push can update protected branches outside the PR workflow';
      }
      if (pushTargetsProtectedBranch(gitArgs, cwd)) {
        return 'direct push to a protected base branch bypasses the required PR and review workflow';
      }
    }
  }

  if (executable === 'prisma') {
    if (args[0] === 'migrate' && args[1] === 'reset')
      return 'Prisma migrate reset destroys database data';
    if (args[0] === 'migrate' && args[1] === 'deploy') {
      return 'Prisma migrate deploy can change a shared or production-like environment';
    }
    if (args[0] === 'db' && args[1] === 'push' && args.includes('--accept-data-loss')) {
      return 'Prisma data-loss push may irreversibly drop data';
    }
  }

  const subcommand = stripLeadingOptions(args)[0];
  if (executable === 'kubectl' && subcommand === 'delete') {
    return 'infrastructure deletion can cause an outage or data loss';
  }
  if (executable === 'helm' && subcommand === 'uninstall') {
    return 'infrastructure deletion can cause an outage or data loss';
  }
  if (executable === 'terraform' && subcommand === 'destroy') {
    return 'infrastructure deletion can cause an outage or data loss';
  }
  if (
    (executable === 'kubectl' && subcommand === 'apply') ||
    (executable === 'helm' && subcommand === 'upgrade') ||
    (executable === 'terraform' && subcommand === 'apply')
  ) {
    return 'this command can change a shared or production-like environment';
  }

  return undefined;
}

function analyzeShell(command, eventCwd) {
  const parsed = parseShellCommands(command);
  if (parsed.ambiguous) return 'the shell command could not be safely parsed';
  for (const tokens of parsed.commands) {
    const reason = analyzeCommand(tokens, eventCwd);
    if (reason) return reason;
  }
  return undefined;
}

const event = readEvent();
const rawToolName = String(event.tool_name ?? event.toolName ?? 'unknown');
const toolName = rawToolName.split(/[.:/]/).at(-1);
const toolInput = event.tool_input ?? event.toolInput ?? {};
const command = typeof toolInput.command === 'string' ? toolInput.command : '';
const commandTool = toolName === 'execute_bash' || toolName === 'control_bash_process';

if (commandTool && command) {
  const reason = analyzeShell(command, typeof event.cwd === 'string' ? event.cwd : process.cwd());
  if (reason) requestConfirmation(`Sensitive operation requires explicit approval: ${reason}.`);
}

const mutatingTool = /^(?:fs_write|str_replace|fs_append|delete_file)$/i.test(toolName);
const pathValues = [toolInput.path, toolInput.targetFile, toolInput.target_file].filter(
  (value) => typeof value === 'string',
);
const protectedPath =
  /(?:^|[\\/])(?:\.env(?:\.(?!example\b)[^\\/]*)?|[^\\/]+\.(?:pem|key|p12|pfx))$/i;
const migrationPath = /(?:^|[\\/])prisma[\\/]migrations[\\/]/i;

if (mutatingTool && pathValues.some((path) => protectedPath.test(path))) {
  requestConfirmation(
    'Writing or deleting a secret-bearing environment/key file requires explicit approval.',
  );
}

if (toolName === 'delete_file' && pathValues.some((path) => migrationPath.test(path))) {
  requestConfirmation(
    'Deleting a committed database migration requires explicit approval and a forward-migration plan.',
  );
}
