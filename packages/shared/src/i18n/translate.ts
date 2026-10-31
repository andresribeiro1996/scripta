export type PluralMessage = { one: string; other: string };
export type Message = string | PluralMessage;
export type Messages = Record<string, Message>;
export type CatalogOf<E extends Messages> = {
  [K in keyof E]: E[K] extends string ? string : PluralMessage;
};
export type Vars = Record<string, string | number>;
export type Translate<M extends Messages> = (key: Extract<keyof M, string>, vars?: Vars) => string;

export function createTranslator<M extends Messages>(messages: M): Translate<M> {
  return (key, vars) => {
    const message: Message = messages[key];
    let text: string;
    if (typeof message === "string") {
      text = message;
    } else {
      if (typeof vars?.count !== "number") {
        throw new Error(`Plural message "${key}" needs a numeric count`);
      }
      text = vars.count === 1 ? message.one : message.other;
    }
    return text.replace(/\{(\w+)\}/g, (match, name: string) =>
      vars && name in vars ? String(vars[name]) : match,
    );
  };
}
