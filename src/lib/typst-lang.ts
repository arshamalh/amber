// Typst language support for CodeMirror: the native Lezer parser from
// `codemirror-lang-typst` (Typst 0.15 syntax, `typst-syntax` node names).
//
// Assembled from the package's parts rather than `typst_lezer()`, so that
// completion and diagnostics come only from Tinymist (one source of truth)
// and not also from the package's own built-in tables and linter.
import {
  Language,
  LanguageSupport,
  defaultHighlightStyle,
  defineLanguageFacet,
  languageDataProp,
  syntaxHighlighting,
} from "@codemirror/language";
import {
  TypstHighlightSytle,
  TypstLezerParser,
  typstLezerFoldService,
  typstLezerFolding,
  typstLezerHighlighting,
  typstLezerIndentService,
  typstLezerIndentation,
  typstLezerListKeymap,
} from "codemirror-lang-typst/lezer";

const data = defineLanguageFacet({
  commentTokens: { line: "//", block: { open: "/*", close: "*/" } },
});

const parser = new TypstLezerParser(
  languageDataProp.add((type) => (type.isTop ? data : undefined)),
  typstLezerHighlighting,
  typstLezerIndentation,
  typstLezerFolding,
);

export const typstLanguage = new Language(data, parser, [], "typst");

export function typst(): LanguageSupport {
  return new LanguageSupport(typstLanguage, [
    syntaxHighlighting(TypstHighlightSytle),
    syntaxHighlighting(defaultHighlightStyle),
    typstLezerIndentService,
    typstLezerListKeymap, // Enter continues lists
    typstLezerFoldService,
  ]);
}
