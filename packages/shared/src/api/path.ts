export function apiPath(strings: TemplateStringsArray, ...values: Array<string | number>): string {
  return strings.reduce((out, part, index) => out + part + (index < values.length ? encodeURIComponent(String(values[index])) : ""), "");
}
