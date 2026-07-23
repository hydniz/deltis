// German user-facing descriptions of each plugin capability, shown on the
// single "alle akzeptieren oder abbrechen" consent screen before install
// (web today, Android later) and again when an individual user grants an
// already-installed plugin access to their own data. Keep in sync with
// docs/plugins/MANIFEST.md.
const DESCRIPTIONS = {
  'habits:read': 'Liest deine Gewohnheiten und deren Einträge.',
  'habits:write': 'Legt Gewohnheiten an oder trägt Einträge für dich ein.',
  'activities:read': 'Liest deine Aktivitäten.',
  'activities:write': 'Legt Aktivitäten für dich an oder ändert sie.',
  'goals:read': 'Liest deine Ziele und deren Fortschritt.',
  'goals:write': 'Legt Ziele für dich an oder ändert sie.',
  'planner:read': 'Liest deinen Wochenplan.',
  'planner:write': 'Trägt Einträge in deinen Wochenplan ein.',
  'weight:read': 'Liest deinen Gewichtsverlauf.',
  'weight:write': 'Trägt Gewichtswerte für dich ein.',
  'user:read': 'Liest deinen Namen und Benutzernamen (niemals dein Passwort oder andere Geheimnisse).',
  'ui:dashboard-widget': 'Zeigt eine eigene Kachel auf deinem Dashboard.',
  'ui:settings-panel': 'Zeigt einen eigenen Bereich in den Einstellungen.',
  'ui:goal-criteria-provider': 'Stellt eigene Bedingungen zur Auswahl bei der Zielerstellung bereit.',
  'background:cron': 'Führt regelmäßig im Hintergrund Aufgaben aus.',
  'background:webhook-receiver': 'Empfängt Webhooks von einem externen Dienst.',
  'notifications:send': 'Kann dir Benachrichtigungen schicken.',
};

function describeCapability(capability) {
  if (DESCRIPTIONS[capability]) return DESCRIPTIONS[capability];
  if (capability.startsWith('network:')) {
    return `Netzwerkzugriff auf ${capability.slice('network:'.length)}.`;
  }
  return capability;
}

function describeAll(capabilities) {
  return (capabilities || []).map((capability) => ({ capability, description: describeCapability(capability) }));
}

module.exports = { describeCapability, describeAll };
