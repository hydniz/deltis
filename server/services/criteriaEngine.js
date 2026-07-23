// Shared criteria-tree machinery.
//
// A criteria document is a rule group `{ operator: 'AND'|'OR', rules: [...] }`
// where every rule is `{ kind, …params }`. This module owns the parts that are
// identical for every integration — nesting, depth limiting, AND/OR evaluation
// and the German validation messages — so an integration only has to declare
// its own rule kinds.
//
// `createEngine` injects the recursive `group` kind into the registry it
// returns, so `RULE_TYPES` still lists `group` alongside the integration's own
// kinds, exactly like services/stravaCriteria.js does by hand.
const MAX_DEPTH = 5;

function createEngine(baseRuleTypes, { maxDepth = MAX_DEPTH } = {}) {
  const RULE_TYPES = {
    ...baseRuleTypes,
    group: {
      validate(rule, path, errors, depth) {
        validateGroup(rule, path, errors, depth + 1);
      },
      evaluate(activity, rule) {
        return evaluateGroup(activity, rule);
      },
    },
  };

  function validateGroup(group, path, errors, depth) {
    if (depth > maxDepth) {
      errors.push(`${path}: maximale Verschachtelungstiefe (${maxDepth}) überschritten`);
      return;
    }
    if (!group || typeof group !== 'object') {
      errors.push(`${path}: Gruppe muss ein Objekt sein`);
      return;
    }
    if (!['AND', 'OR'].includes(group.operator)) {
      errors.push(`${path}: "operator" muss AND oder OR sein`);
    }
    if (!Array.isArray(group.rules) || group.rules.length === 0) {
      errors.push(`${path}: "rules" darf nicht leer sein`);
      return;
    }
    group.rules.forEach((rule, i) => {
      const rulePath = `${path}.rules[${i}]`;
      const type = RULE_TYPES[rule?.kind];
      if (!type) {
        errors.push(`${rulePath}: unbekannter Regel-Typ "${rule?.kind}" (verfügbar: ${Object.keys(RULE_TYPES).join(', ')})`);
        return;
      }
      type.validate(rule, rulePath, errors, depth);
    });
  }

  function evaluateGroup(activity, group) {
    const results = group.rules.map(rule => RULE_TYPES[rule.kind].evaluate(activity, rule));
    return group.operator === 'OR' ? results.some(Boolean) : results.every(Boolean);
  }

  // Validates a criteria document; returns { valid, errors }.
  function validateCriteria(criteria) {
    const errors = [];
    validateGroup(criteria, 'criteria', errors, 1);
    return { valid: errors.length === 0, errors };
  }

  // True when the activity satisfies the criteria. Invalid criteria never match.
  function evaluateActivity(activity, criteria) {
    if (!validateCriteria(criteria).valid) return false;
    return evaluateGroup(activity, criteria);
  }

  return { RULE_TYPES, validateCriteria, evaluateActivity };
}

module.exports = { MAX_DEPTH, createEngine };
