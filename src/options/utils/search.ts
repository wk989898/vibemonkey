import { escapeStringForRegExp, normalizeTag } from "@/common";

const reToken =
  /\s*(!)?(#|(name|code|desc)(\+re)?:|(re:)|)('((?:[^']+|'')*)('|$)|"((?:[^"]+|"")*)("|$)|\/(\S+?)\/([a-z]*)|\S+)(?:\s+|$)/y;
const reTwoSingleQuotes = /''/g;
const reTwoDoubleQuotes = /""/g;

type SearchableCache = Record<string, string | number | undefined> & {
  code: string;
  desc: string;
  show: boolean | number;
};

type SearchableScript = {
  $cache: SearchableCache;
};

export function createSearchRules(search: string): VMSearchRuleset {
  const rules: VMSearchRule[] = [];
  const tokens: VMSearchToken[] = [];
  const includeTags: string[] = [];
  const excludeTags: string[] = [];
  reToken.lastIndex = 0;
  for (let m; (m = reToken.exec(search)); ) {
    let [
      ,
      negative,
      prefix,
      scope = "",
      re1,
      re2,
      raw,
      q1,
      q1end,
      quoted = q1,
      quoteEnd = q1end,
      reStr,
      flags = "",
    ] = m;
    let str: string;
    if (quoted) {
      if (!quoteEnd) throw new Error("Unmatched quotes");
      str = quoted.replace(q1 ? reTwoSingleQuotes : reTwoDoubleQuotes, quoted[0]);
    } else {
      str = raw;
    }
    negative = !!negative;
    tokens.push({
      negative,
      prefix,
      raw,
      parsed: str,
    });
    if (prefix === "#") {
      str = normalizeTag(str).replace(/\./g, "\\.");
      if (str) (negative ? excludeTags : includeTags).push(str);
    } else {
      if (re1 || re2) {
        flags = "i";
      } else if (reStr) {
        str = reStr;
      } else {
        if (!quoted) flags = "i";
        str = escapeStringForRegExp(str);
      }
      /** @namespace VMSearchRule */
      rules.push({
        negative,
        scope: scope as VMSearchRuleScope,
        re: new RegExp(str, flags.includes("u") ? flags : flags + "u"),
      });
    }
  }
  [includeTags, excludeTags].forEach((tags, negative) => {
    if (tags.length) {
      rules.unshift({
        scope: "tags",
        re: new RegExp(`(?:^|\\s)(${tags.join("|").toLowerCase()})(\\s|$)`, "u"),
        negative: !!negative,
      });
    }
  });
  return {
    tokens,
    rules,
  };
}

export function testSearchRule(this: SearchableCache, { re, negative, scope }: VMSearchRule) {
  return (
    Number(negative) ^
    Number(re.test(this[scope || "desc"] as string) || (!scope && re.test(this.code)))
  );
}

export function performSearch(scripts: SearchableScript[], rules: VMSearchRule[]) {
  let res = 0;
  for (const { $cache } of scripts) {
    const show = rules.every(testSearchRule, $cache);
    $cache.show = show;
    res += Number(show);
  }
  return res;
}
