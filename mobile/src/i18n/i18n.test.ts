import assert from "node:assert/strict";
import { test } from "node:test";
import { catalogMismatches } from "@scripta/shared/i18n";
import { reconcileAppearance, type AccountAppearance } from "@scripta/shared/themes";
import { en } from "./messages/en";
import { ptPT } from "./messages/pt-PT";
import { authorizationCodeFromGoogleRedirect } from "../features/auth/googleSignInResult";
import { getLocale, getLocalePreference, setDeviceLocaleTags, setLocalePreference, t } from "./index";

test("the mobile catalog has no placeholder mismatches", () => {
  assert.deepEqual(catalogMismatches(en, ptPT), []);
});

test("English is the default, and a Portuguese device alone does not change it before launch", () => {
  assert.equal(getLocale(), "en");
  setDeviceLocaleTags(["pt-PT"]);
  try {
    assert.equal(getLocale(), "en");
  } finally {
    setDeviceLocaleTags([]);
  }
});

test("an explicit pt-PT pick switches t()", () => {
  setLocalePreference("pt-PT");
  try {
    assert.equal(getLocale(), "pt-PT");
    assert.equal(t("settings.language"), "Idioma");
    assert.equal(t("errors.requestFailed", { status: 502 }), "O pedido falhou (502)");
  } finally {
    setLocalePreference("auto");
  }
  assert.equal(t("settings.language"), "Language");
});

test("the shell strings and the sign-in redirect error follow the pick", () => {
  assert.equal(t("shell.signIn"), "Sign in");
  assert.throws(() => authorizationCodeFromGoogleRedirect("scripta://oauth-redirect?state=wrong", "nonce"), /did not match the request/);
  setLocalePreference("pt-PT");
  try {
    assert.equal(t("shell.signIn"), "Iniciar sessão");
    assert.equal(t("shell.tabYou"), "Perfil");
    assert.equal(t("shell.resendIn", { seconds: 30 }), "Reenviar em 30s");
    assert.throws(() => authorizationCodeFromGoogleRedirect("scripta://oauth-redirect?state=wrong", "nonce"), /não corresponde ao pedido/);
  } finally {
    setLocalePreference("auto");
  }
});

test("a locale from the account is applied to the device pick and the device pick is what gets reconciled", () => {
  const account: AccountAppearance = { theme: null, displayFont: null, textFont: null, locale: "pt-PT" };
  const device = { theme: "system", displayFont: "theme", textFont: "theme", locale: getLocalePreference() } as const;
  const { apply, upload } = reconcileAppearance(account, device);
  assert.equal(apply.locale, "pt-PT");
  assert.equal(upload.locale, undefined);
  setLocalePreference(apply.locale!);
  try {
    assert.equal(getLocalePreference(), "pt-PT");
    assert.deepEqual(reconcileAppearance({ ...account, locale: null }, { ...device, locale: getLocalePreference() }).upload, { theme: "system", displayFont: "theme", textFont: "theme", locale: "pt-PT" });
  } finally {
    setLocalePreference("auto");
  }
});

test("counts pick the singular in Portuguese and keep today's English at every count", () => {
  const cases: Array<[Parameters<typeof t>[0], Record<string, number | string>, string, string, string]> = [
    ["murals.countFinished", { count: 1 }, "1 finished", "1 lido", "2 lidos"],
    ["quizzes.statStreak", { count: 1 }, "day streak", "dia seguido", "dias seguidos"],
    ["quizzes.statPerfect", { count: 1 }, "perfect", "perfeito", "perfeitos"],
    ["book.castSelected", { count: 1 }, "1 characters", "1 personagem", "2 personagens"],
    ["tierlists.rankLeft", { count: 1 }, "Rank · 1 left", "Classificar · falta 1", "Classificar · faltam 2"],
  ];
  for (const [key, vars, english, one, other] of cases) {
    assert.equal(t(key, vars), english);
    setLocalePreference("pt-PT");
    try {
      assert.equal(t(key, vars), one);
      assert.equal(t(key, { ...vars, count: 2 }), other);
    } finally {
      setLocalePreference("auto");
    }
  }
  assert.equal(t("book.castSelected", { count: 2 }), "2 characters");
  assert.equal(t("quizzes.statStreak", { count: 5 }), "day streak");
});

test("the Daily Chapter summaries compose per-count plurals", () => {
  const vars = (played: number, streak: number) => ({ played: t("quizzes.playedCount", { count: played }), streak: t("quizzes.dayStreakCount", { count: streak }) });
  assert.equal(t("quizzes.chaptersLink", vars(1, 1)), "Your chapters · 1 played · 1 day streak ›");
  assert.equal(t("quizzes.chaptersLinkLabel", vars(3, 2)), "Your chapters, 3 played, 2 day streak");
  assert.equal(t("quizzes.completedSummary", { completed: t("quizzes.completedCount", { count: 4 }), streak: t("quizzes.dayStreakCount", { count: 1 }) }), "4 completed · 1 day streak");
  assert.equal(t("quizzes.themeStats", { completed: 2, eligible: 5, since: "1 Oct", correct: 8, answered: 10, count: 1 }), "2/5 editions since 1 Oct · 8/10 correct · 1 perfect");
  setLocalePreference("pt-PT");
  try {
    assert.equal(t("quizzes.chaptersLink", vars(1, 1)), "Os seus capítulos · 1 jogado · sequência de 1 dia ›");
    assert.equal(t("quizzes.chaptersLinkLabel", vars(3, 2)), "Os seus capítulos, 3 jogados, sequência de 2 dias");
    assert.equal(t("quizzes.completedSummary", { completed: t("quizzes.completedCount", { count: 1 }), streak: t("quizzes.dayStreakCount", { count: 3 }) }), "1 concluído · sequência de 3 dias");
    assert.equal(t("quizzes.themeStats", { completed: 2, eligible: 5, since: "1 out", correct: 8, answered: 10, count: 1 }), "2/5 edições desde 1 out · 8/10 certas · 1 perfeita");
  } finally {
    setLocalePreference("auto");
  }
});
