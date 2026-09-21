/** Counts that read naturally: "1 question", "3 questions", "1 interview". */
export function plural(count: number, singular: string, many = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : many}`;
}
