const PREFIX = 'exec:';
export function taskExec(labels?: string[]): string {
  const label = labels?.find((l) => l.startsWith(PREFIX));
  return label ? label.slice(PREFIX.length) : '';
}
