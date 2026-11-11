# DamnedCloud

Client **Android** per il controllo remoto di [DamnedIDE](https://github.com/DamnedMe/DamnedIDE).

DamnedCloud si associa all'IDE in esecuzione sul PC (via **Tailscale**) e permette di
vedere e comandare da telefono, con una UI pensata per il mobile:

- **Worktree** — elenco, selezione, stato
- **Modifiche** — file modificati, diff, stage/unstage, commit, discard
- **Editor** — albero file, lettura e modifica con salvataggio
- **SQL** — connessioni già aperte sul desktop, database/tabelle, esecuzione query
- **Impostazioni** — dispositivi, permessi, connessione

Le azioni distruttive (discard, rimozione worktree, query che modificano dati) richiedono
una conferma esplicita.

## Architettura

```
DamnedIDE (PC)                         DamnedCloud (telefono)
┌──────────────────────────┐           ┌───────────────────────┐
│ Electron main            │           │ React + Capacitor     │
│  remote.service          │  WebSocket│  connection / store   │
│  ws-server (Tailscale IP)│◄─────────►│  screens              │
│  git/worktree/sql/fs     │  protocol │  pairing (QR)         │
└──────────────────────────┘           └───────────────────────┘
        ▲                                        ▲
        └──────────── Tailscale (WireGuard) ─────┘
```

Il protocollo condiviso è `src/shared/remote/protocol.ts` (copia gemella in
`DamnedIDE/src/shared/remote/protocol.ts`; vanno tenuti allineati).

## Sviluppo

```bash
npm install
npm run dev        # UI nel browser (senza native)
npm run build      # build web in dist/
npx cap sync android
```

Per l'APK in locale serve Java 21 + Android SDK:

```bash
npm run android:apk   # -> android/app/build/outputs/apk/debug/app-debug.apk
```

In CI l'APK viene compilato e allegato alla Release come `DamnedCloud.apk`
(workflow `.github/workflows/android.yml`).

## Installazione / aggiornamento

`versionName` e `versionCode` vengono dalla `version` di `package.json` (1.2.3 → 10203).
Android installa un aggiornamento sopra l'app solo se l'APK è firmato con la **stessa chiave**:
la CI firma con i secret `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Senza secret usa una chiave di debug nuova a ogni
build (warning nel log): bisogna disinstallare l'app e rifare l'associazione. Anche il primo
passaggio alla chiave stabile richiede una disinstallazione.

```bash
# una volta sola; conserva il file e la password (con PKCS12 la password della chiave è la stessa)
keytool -genkeypair -keystore damnedcloud.jks -alias damnedcloud -keyalg RSA -keysize 4096 -validity 36500
base64 -w0 damnedcloud.jks   # -> secret ANDROID_KEYSTORE_BASE64
```

Per una build locale installabile sopra quella della CI: `ANDROID_KEYSTORE_FILE` (percorso del
`.jks`) più le stesse variabili, come env o in `~/.gradle/gradle.properties`.

## Associazione (un solo QR)

1. In DamnedIDE: **Impostazioni → Mobile → associa telefono**.
2. Scansiona il QR: apre la landing (GitHub Pages) che offre il download dell'APK
   e il deep link `damnedcloud://pair?...`.
3. Con l'app installata, il link la apre e completa l'associazione; sul desktop
   compare una richiesta con un codice a 6 cifre da confermare.

## Sicurezza

- Traffico cifrato dalla rete privata **Tailscale** (WireGuard).
- **Token per dispositivo** (salvato come hash sul PC), permessi per dispositivo,
  revoca singola o totale.
- Le credenziali SQL restano sul PC: il telefono usa solo connessioni già aperte.
- I percorsi file sono limitati al repository/worktree aperti.
