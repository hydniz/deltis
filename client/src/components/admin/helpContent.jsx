// German help copy for the admin settings.
//
// `short` is the hover tooltip: one sentence that ADDS to the description
// already printed under the label – never a repeat of it.
// `long` is the click-through explanation: what it does, what to enter, and
// what happens if it is wrong.
//
// CONFIG_HELP is keyed by config key (see server/utils/config.js), so every
// ConfigRow finds its own help without the call site passing anything.

export const CONFIG_HELP = {
  PORT: {
    short: 'Standard ist 3001. Der Port muss auf dem NAS frei sein, sonst startet der Server nicht.',
    long: (
      <>
        <p>
          Der TCP-Port, auf dem Deltis Anfragen entgegennimmt. Voreingestellt ist
          <code>3001</code>.
        </p>
        <p>
          <strong>Im Docker-Betrieb</strong> ist das der Port <em>innerhalb</em> des
          Containers. Von außen zählt, was in der <code>docker-compose.yml</code> unter
          <code>ports</code> steht (z.B. <code>8080:3001</code>) – diesen Wert hier zu
          ändern reicht dann nicht aus.
        </p>
        <p>
          <strong>Achtung:</strong> Ist der Port bereits belegt, startet der Server nach
          dem Neustart nicht mehr. Wähle einen Port über 1024, der von keinem anderen
          Dienst genutzt wird.
        </p>
      </>
    ),
  },
  MONGODB_URI: {
    short: 'Zeigt Host und Datenbankname – Benutzername und Passwort werden ausgeblendet.',
    long: (
      <>
        <p>
          Die Verbindungszeichenkette zur MongoDB, z.B.
          <code>mongodb://localhost:27017/deltis</code>.
        </p>
        <p>
          Aus Sicherheitsgründen werden eingebettete Zugangsdaten maskiert
          dargestellt: aus <code>mongodb://nutzer:geheim@host/db</code> wird
          <code>mongodb://***:***@host/db</code>. Host und Datenbankname bleiben
          sichtbar, damit du prüfen kannst, ob das Ziel stimmt. Beim Bearbeiten musst du
          die URI deshalb <strong>vollständig</strong> neu eingeben.
        </p>
        <p>
          Dieser Wert wird nicht in der Datenbank gespeichert – er wird ja gebraucht, um
          sie überhaupt zu erreichen. Er landet in
          <code>/etc/deltis/deltis.config.json</code> und wird erst nach einem
          <strong>Serverneustart</strong> wirksam.
        </p>
      </>
    ),
  },
  JWT_SECRET: {
    short: 'Wird nie angezeigt – es wird nur gemeldet, ob ein Wert gesetzt ist.',
    long: (
      <>
        <p>
          Mit diesem Geheimnis werden Session-Token (JWT) signiert. Damit weist der
          Server nach, dass ein Token wirklich von ihm stammt.
        </p>
        <p>
          Der Wert wird <strong>niemals</strong> an die Oberfläche übertragen – angezeigt
          wird nur, ob überhaupt einer gesetzt ist. Nutze eine lange Zufallszeichenkette,
          z.B. <code>openssl rand -hex 32</code>.
        </p>
        <p>
          <strong>Folge einer Änderung:</strong> Alle bestehenden Sessions werden
          ungültig, alle Nutzer müssen sich neu anmelden. Daten gehen dabei nicht
          verloren.
        </p>
      </>
    ),
  },
  JWT_SECRET_FILE: {
    short: 'Pfad statt Wert: Das Geheimnis steht in einer Datei und nicht in der Konfiguration.',
    long: (
      <>
        <p>
          Pfad zu einer Datei, deren Inhalt als JWT-Secret verwendet wird – die bevorzugte
          Variante, etwa für Docker-Secrets.
        </p>
        <p>
          Ist beides gesetzt, <strong>gewinnt die Datei</strong> gegenüber
          <code>JWT_SECRET</code>. Der Pfad selbst ist kein Geheimnis und wird deshalb
          angezeigt; die Datei muss für den Serverprozess lesbar sein.
        </p>
      </>
    ),
  },
  PEPPER_FILE: {
    short: 'Nach dem ersten Nutzerkonto nicht mehr änderbar – sonst schlagen alle Logins fehl.',
    long: (
      <>
        <p>
          Pfad zu einer Datei mit dem Pepper. Der Pepper ist ein serverweites Geheimnis,
          das vor dem Hashen an jedes Passwort angehängt wird. Wer nur die Datenbank
          erbeutet, kann die Hashes ohne ihn nicht angreifen.
        </p>
        <p>
          <strong>Setze ihn, bevor der erste Nutzer angelegt wird.</strong> Ändert man ihn
          später, passt kein einziger gespeicherter Hash mehr – <em>niemand</em> kann sich
          dann noch anmelden, und es gibt keinen Weg zurück außer dem alten Pepper.
        </p>
      </>
    ),
  },
  PASSWORD_PEPPER: {
    short: 'Wie die Pepper-Datei, aber direkt in der Konfiguration – nur als Notlösung.',
    long: (
      <>
        <p>
          Der Pepper-Wert direkt, statt über eine Datei. Bequemer, aber unsicherer: Der
          Wert steht damit in der Konfiguration bzw. in der Umgebung des Prozesses.
        </p>
        <p>
          Bevorzuge <strong>Pepper-Datei</strong>. Angezeigt wird der Wert nie – nur, ob
          er gesetzt ist.
        </p>
        <p>
          <strong>Ebenso endgültig:</strong> Nach dem ersten Nutzerkonto darf er sich nie
          mehr ändern, sonst schlagen alle Anmeldungen fehl.
        </p>
      </>
    ),
  },
  REGISTRATION_ENABLED: {
    short: 'Standard "off": Nur Admins legen Konten an. Auf "on" darf sich jeder selbst registrieren.',
    long: (
      <>
        <p>
          Steuert, wer ein Konto bekommt:
        </p>
        <ul>
          <li>
            <strong>off</strong> – nur Administratoren legen Nutzer an. Die
            Registrierungsseite ist nicht erreichbar. Empfohlen für eine private Instanz.
          </li>
          <li>
            <strong>on</strong> – jeder, der die Instanz erreicht, kann sich selbst ein
            Konto erstellen.
          </li>
        </ul>
        <p>
          Ist die Instanz aus dem Internet erreichbar, bedeutet <strong>on</strong>, dass
          Fremde Konten anlegen können. Registrierungen sind zwar rate-limitiert, aber
          begrenze zusätzlich die <strong>Max. Nutzeranzahl</strong>.
        </p>
      </>
    ),
  },
  REGISTRATION_USER_LIMIT: {
    short: '0 heißt unbegrenzt. Greift nur, solange die Selbstregistrierung aktiv ist.',
    long: (
      <>
        <p>
          Obergrenze an Konten, die per Selbstregistrierung entstehen dürfen. Ist sie
          erreicht, weist der Server weitere Registrierungen ab.
        </p>
        <p>
          <code>0</code> bedeutet <strong>unbegrenzt</strong>. Bei aktiver
          Selbstregistrierung ist ein knapp bemessenes Limit (z.B. die Anzahl Personen im
          Haushalt) der wirksamste Schutz gegen Missbrauch.
        </p>
        <p>
          Administratoren können unabhängig davon jederzeit weitere Nutzer anlegen – das
          Limit gilt nur für die Selbstregistrierung.
        </p>
      </>
    ),
  },
  UPDATE_REPO_URL: {
    short: 'Quelle für Versionsprüfung und Update – muss ein öffentliches GitHub-Repository sein.',
    long: (
      <>
        <p>
          Das GitHub-Repository, in dem Deltis nach neuen Versionen sucht. Voreingestellt
          ist das offizielle <code>https://github.com/hydniz/deltis</code>.
        </p>
        <p>
          Das Repository muss <strong>öffentlich</strong> sein: Die Prüfung läuft ohne
          Zugangsdaten über die GitHub-API. Ein eigener Fork funktioniert, sofern er
          dieselben Versions-Tags (<code>v1.2.3</code>) verwendet.
        </p>
        <p>
          Ohne gültige URL ist keine Prüfung und kein Update möglich.
        </p>
      </>
    ),
  },
  UPDATE_DOCKER_IMAGE: {
    short: 'Nur im Docker-Betrieb sichtbar. Der Tag wird je Kanal automatisch angehängt.',
    long: (
      <>
        <p>
          Das Docker-Hub-Image, das beim Update geladen wird – ohne Tag, z.B.
          <code>hydniz/deltis</code>.
        </p>
        <p>
          Den Tag bestimmt der Release-Kanal automatisch: Bei
          <strong> stable/beta/alpha</strong> die Version (<code>hydniz/deltis:1.2.3</code>),
          beim Kanal <strong>main</strong> der Commit-Hash.
        </p>
        <p>
          Diese Einstellung erscheint nur, wenn Deltis in Docker läuft – bei einer
          Host-Installation wird per Git aktualisiert.
        </p>
      </>
    ),
  },
};

export const SECTION_HELP = {
  server: {
    title: 'Server',
    short: 'Port und Datenbankverbindung. Änderungen greifen erst nach einem Neustart.',
    long: (
      <>
        <p>
          Die Grundeinstellungen des Servers: auf welchem Port er lauscht und mit welcher
          MongoDB er spricht.
        </p>
        <p>
          Beide Werte werden beim Start gelesen. Eine Änderung wird deshalb erst nach
          einem <strong>Serverneustart</strong> wirksam – die laufende Instanz arbeitet bis
          dahin unverändert weiter.
        </p>
        <p>
          Stehen die Werte in der <code>.env</code>, sind sie hier gesperrt. Das ist kein
          Fehler, sondern die gewollte Rangfolge: <code>.env</code> schlägt jede
          Einstellung aus der Oberfläche.
        </p>
      </>
    ),
  },
  security: {
    title: 'Sicherheit',
    short: 'Die Geheimnisse für Sessions und Passwort-Hashing – nicht nachträglich ändern.',
    long: (
      <>
        <p>
          Hier liegen die kryptografischen Geheimnisse: das <strong>JWT-Secret</strong> für
          Session-Token und der <strong>Pepper</strong> für das Passwort-Hashing.
        </p>
        <p>
          Werte werden nie angezeigt – nur, ob sie gesetzt sind. Für die Dateivarianten
          wird der Pfad angezeigt, weil er kein Geheimnis ist.
        </p>
        <p>
          <strong>Wichtigste Regel:</strong> Den Pepper vor dem ersten Nutzerkonto setzen
          und danach nie wieder ändern – sonst kann sich niemand mehr anmelden. Ein
          geändertes JWT-Secret ist harmloser: Es wirft nur alle offenen Sessions raus.
        </p>
      </>
    ),
  },
  access: {
    title: 'Registrierung & Zugang',
    short: 'Wer ein Konto bekommt: nur per Admin, oder Selbstregistrierung mit Obergrenze.',
    long: (
      <>
        <p>
          Diese Einstellungen entscheiden, <strong>wer ein Konto bekommt</strong> – nicht,
          wie sicher die Konten sind. Deshalb stehen sie getrennt von den
          Sicherheitsgeheimnissen.
        </p>
        <p>
          Standard ist die geschlossene Instanz: Nur Administratoren legen Nutzer an.
          Erlaubst du die Selbstregistrierung, setze zusätzlich eine
          <strong> Max. Nutzeranzahl</strong>, damit die Instanz nicht volläuft.
        </p>
      </>
    ),
  },
  precedence: {
    title: 'Woher ein Wert kommt',
    short: 'Die Rangfolge der Quellen – und warum manche Werte gesperrt sind.',
    long: (
      <>
        <p>Jede Einstellung trägt ein Kennzeichen, das ihre Quelle zeigt:</p>
        <ul>
          <li>
            <strong>.env – gesperrt</strong>: aus <code>.env</code> bzw.
            <code>docker-compose.yml</code>. Höchster Rang, hier nicht änderbar.
          </li>
          <li><strong>Datenbank</strong>: hier gesetzt, in der Datenbank gespeichert.</li>
          <li>
            <strong>Konfigurationsdatei</strong>: in
            <code>/etc/deltis/deltis.config.json</code> – für Werte, die gebraucht werden,
            bevor die Datenbank erreichbar ist.
          </li>
          <li><strong>Standard</strong>: nirgends gesetzt, der eingebaute Vorgabewert gilt.</li>
        </ul>
        <p>
          Die Rangfolge lautet <code>.env</code> → Datenbank/Datei → Standard. Um einen
          gesperrten Wert zu ändern, entferne ihn aus der <code>.env</code> und starte den
          Server neu.
        </p>
      </>
    ),
  },
  channel: {
    title: 'Release-Kanal',
    short: 'Bestimmt, welche Versionen als Update angeboten werden – ein Wechsel downgradet nie.',
    long: (
      <>
        <p>Der Kanal legt fest, wonach Deltis auf GitHub sucht:</p>
        <ul>
          <li><strong>Stable</strong> – fertige Releases (<code>v1.2.3</code>). Empfohlen.</li>
          <li><strong>Beta</strong> – Vorschau auf das nächste Release, weitgehend stabil.</li>
          <li><strong>Alpha</strong> – Entwicklungsversionen, können Fehler enthalten.</li>
          <li>
            <strong>Main Branch</strong> – der jeweils neueste Commit auf <code>main</code>,
            ungetestet. Der Branch ist fest vorgegeben; ein eigener Branch lässt sich
            bewusst nicht eintragen.
          </li>
        </ul>
        <p>
          <strong>Ein Kanalwechsel führt nie ein Downgrade durch.</strong> Ist die neueste
          Version des neuen Kanals älter als die installierte – etwa bei Wechsel von
          Stable <code>v1.2.3</code> auf Alpha <code>v1.2.0-alpha</code> – wird kein Update
          angeboten. Die Installation bleibt, wie sie ist, bis der neue Kanal die
          installierte Version überholt hat.
        </p>
        <p>
          Der Kanal wirkt sofort auf die Prüfung, aber nie von allein auf die
          Installation: Ein Update startet nur, wenn du es startest.
        </p>
      </>
    ),
  },
  updateStart: {
    title: 'Update starten',
    short: 'Ohne erfolgreiche Datensicherung wird kein Update durchgeführt.',
    long: (
      <>
        <p>Ein Update läuft immer in dieser Reihenfolge:</p>
        <ul>
          <li><strong>Zielversion ermitteln</strong> – die neueste Version im gewählten Kanal.</li>
          <li>
            <strong>Datensicherung</strong> – schlägt sie fehl, bricht das Update ab und
            die Datenbank bleibt unangetastet.
          </li>
          <li><strong>Einspielen</strong> – neues Image bzw. Checkout der Zielversion.</li>
          <li><strong>Neustart</strong> – bei Fehlern wird die alte Version wiederhergestellt.</li>
        </ul>
        <p>
          Der Knopf ist nur aktiv, wenn es tatsächlich etwas Neueres gibt. Bist du bereits
          aktuell, gibt es nichts einzuspielen – ein erneuter Lauf würde dieselbe Version
          installieren und den Dienst ohne Grund neu starten.
        </p>
        <p>
          Jeder Schritt wird protokolliert – unten live und dauerhaft in
          <code>backups/update-logs/</code>.
        </p>
      </>
    ),
  },
  updateSettings: {
    title: 'Update-Einstellungen',
    short: 'Quelle der Updates. Der Release-Kanal wird oben eingestellt.',
    long: (
      <>
        <p>
          Hier steht, <strong>woher</strong> Updates kommen: das GitHub-Repository und – im
          Docker-Betrieb – das zu ladende Image.
        </p>
        <p>
          <strong>Welche</strong> Version daraus genommen wird, entscheidet der
          Release-Kanal weiter oben. Deshalb taucht der Kanal hier nicht noch einmal auf.
        </p>
      </>
    ),
  },
};
