import { parse } from "espree";
import { analyze } from "eslint-scope";
import globals from "globals";

export const RUNTIME_GLOBALS = new Set([
  ...Object.keys(globals.es2027),
  ...Object.keys(globals.browser),
  "undefined",
  "NaN",
  "Infinity",
  "globalThis",
  "arguments",
  "Scratch",
]);

const PARSE_OPTIONS = { ecmaVersion: "latest", sourceType: "script", range: true };
const ANALYZE_OPTIONS = { ecmaVersion: "latest", sourceType: "script", ignoreEval: true };

function analyzeSource(text) {
  const ast = parse(text, PARSE_OPTIONS);
  return analyze(ast, ANALYZE_OPTIONS);
}

export function handlerFreeVariables(source) {
  let scopeManager;
  let expressionError;
  try {
    scopeManager = analyzeSource(`(${source}\n)`);
  } catch (err) {
    expressionError = err;
    try {
      scopeManager = analyzeSource(`({${source}\n})`);
    } catch (methodError) {
      // Both wraps failed: report the error from the wrap that matches how
      // the source is written, since the other one fails on shape alone.
      throw /^(?:async\s+)?[A-Za-z_$][\w$]*\s*\(/.test(source.trim())
        ? methodError
        : expressionError;
    }
  }
  return new Set(scopeManager.globalScope.through.map((ref) => ref.identifier.name));
}

const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

function containsTopLevelReturn(node, insideFunction) {
  if (Array.isArray(node)) {
    return node.some((child) => containsTopLevelReturn(child, insideFunction));
  }
  if (!node || typeof node !== "object" || typeof node.type !== "string") return false;
  if (node.type === "ReturnStatement") return !insideFunction;
  const entersFunction = FUNCTION_TYPES.has(node.type);
  for (const [key, value] of Object.entries(node)) {
    if (key === "loc" || key === "range" || key === "start" || key === "end") continue;
    if (containsTopLevelReturn(value, insideFunction || entersFunction)) return true;
  }
  return false;
}

export function hasTopLevelReturn(source) {
  // A bare `return` is illegal at program top level, so parse the source as
  // the body of a synthetic function and look at that body's statements.
  const ast = parse(`function __twext_setup__() {\n${source}\n}`, {
    ecmaVersion: "latest",
    sourceType: "script",
  });
  const [declaration] = ast.body;
  if (!declaration || declaration.type !== "FunctionDeclaration") return false;
  return declaration.body.body.some((statement) => containsTopLevelReturn(statement, false));
}

export function programFreeVariables(source) {
  const scopeManager = analyzeSource(source);
  return new Set(scopeManager.globalScope.through.map((ref) => ref.identifier.name));
}

export function topLevelDeclarations(source) {
  const scopeManager = analyzeSource(source);
  return new Set(scopeManager.globalScope.variables.map((variable) => variable.name));
}
