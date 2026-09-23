import { parse } from "espree";

const PARSE_OPTIONS = { ecmaVersion: "latest", sourceType: "script", range: true };

function expressionFunction(text) {
  let ast;
  try {
    ast = parse(`(${text}\n)`, PARSE_OPTIONS);
  } catch {
    return null;
  }
  const [statement] = ast.body;
  if (!statement || statement.type !== "ExpressionStatement") return null;
  const node = statement.expression;
  if (node.type !== "FunctionExpression" && node.type !== "ArrowFunctionExpression") return null;
  return { node, offset: 1 };
}

function methodFunction(text) {
  let ast;
  try {
    ast = parse(`({${text}\n})`, PARSE_OPTIONS);
  } catch {
    return null;
  }
  const [statement] = ast.body;
  if (!statement || statement.type !== "ExpressionStatement") return null;
  const object = statement.expression;
  if (object.type !== "ObjectExpression" || object.properties.length !== 1) return null;
  const property = object.properties[0];
  if (property.type !== "Property" || property.method !== true) return null;
  return { node: property.value, offset: 2 };
}

function sliceRange(text, offset, start, end) {
  return text.slice(start - offset, end - offset);
}

export function parseFunctionSource(source) {
  const text = source.trim();
  const found = expressionFunction(text) ?? methodFunction(text);
  if (!found || found.node.generator) return null;
  const { node, offset } = found;
  const params =
    node.params.length === 0
      ? ""
      : sliceRange(
          text,
          offset,
          node.params[0].range[0],
          node.params[node.params.length - 1].range[1],
        );
  if (node.body.type !== "BlockStatement") {
    return {
      async: Boolean(node.async),
      params,
      body: sliceRange(text, offset, node.body.range[0], node.body.range[1]).trim(),
      expressionBody: true,
    };
  }
  return {
    async: Boolean(node.async),
    params,
    body: sliceRange(text, offset, node.body.range[0] + 1, node.body.range[1] - 1),
    expressionBody: false,
  };
}
