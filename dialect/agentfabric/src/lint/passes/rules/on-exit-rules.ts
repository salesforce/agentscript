import { isNamedMap } from '@agentscript/language';
import { asStatements, attachError, type AstLike } from './shared.js';

export function checkOnExitRules(root: Record<string, unknown>): void {
  const nodeGroups = [
    root.orchestrator,
    root.subagent,
    root.generator,
    root.executor,
    root.echo,
  ];
  for (const group of nodeGroups) {
    if (!isNamedMap(group)) continue;
    for (const [, entry] of group) {
      if (entry == null || typeof entry !== 'object') continue;
      const onExit = (entry as Record<string, unknown>).on_exit;
      if (onExit === undefined) continue;
      const invalid = asStatements(onExit).some(
        stmt => stmt.__kind !== 'TransitionStatement'
      );
      if (invalid) {
        attachError(
          entry as AstLike,
          "on_exit may only contain 'transition ...' statements.",
          'on-exit-transition-only'
        );
      }
    }
  }
}
