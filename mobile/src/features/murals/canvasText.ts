export function quoteText(passage: string | undefined, placeholder: string): string {
  return passage === undefined ? placeholder : `“${passage}”`;
}

export function foldersButtonLabel(current: string, folders: string, compose: (label: string) => string): string {
  return current === folders ? folders : compose(current);
}
