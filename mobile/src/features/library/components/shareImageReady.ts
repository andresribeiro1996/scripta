export function shareImageReady(renderable: boolean, expected: readonly string[], loaded: ReadonlySet<string>): boolean {
  return renderable && expected.every((key) => loaded.has(key));
}
