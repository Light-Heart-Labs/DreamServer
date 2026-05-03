const {
  classifyIntent,
  getRouteForIntent,
  getRoutingCatalog: getIntentRoutingCatalog
} = require("./intent");

function detectRoute(text = "") {
  return getRouteForIntent(classifyIntent(text));
}

function getRoutingCatalog() {
  return getIntentRoutingCatalog();
}

function describeRoutingCatalog() {
  return [
    "Rotas de agente:",
    ...getRoutingCatalog().map(([id, desc]) => `- ${id} -> ${desc}`)
  ].join("\n");
}

module.exports = {
  describeRoutingCatalog,
  detectRoute
};
