# DamnedCloud

Client **Android** per il controllo remoto di [DamnedIDE](https://github.com/DamnedMe/DamnedIDE).

DamnedCloud si associa all'IDE in esecuzione sul PC (via **Tailscale**) e permette di
vedere e comandare da telefono, con una UI pensata per il mobile:

- **Worktree** — elenco, selezione, stato; cambio repository tra le recenti dell'IDE
- **Modifiche** — zone staged / modifiche raggruppate per tipo come nell'IDE (Controller, Service, DB, …),
  stage/unstage, commit, discard; inspector del diff unificato o affiancato con zoom, a tutto schermo
  col telefono in orizzontale; « editor » apre il file alla riga toccata (o alla prima modifica)
- **Rilascio** — il pannello Rilascio dell'IDE (Azure DevOps): develop → qa, qa → prod o la catena
  develop → qa → prod per BE/FE, con branch, commit e work item da includere; le catene in corso
  si seguono e si annullano dal telefono (richiede DamnedIDE con il rilascio remoto)
- **Editor** — albero file, lettura e modifica con salvataggio, numeri di riga
- **Tema** — lo stesso dell'IDE (scuro/chiaro e colore primario), ricordato anche offline
- **SQL** — connessioni già aperte sul desktop, database/tabelle, esecuzione query
- **Impostazioni** — dispositivi, permessi, connessione

Le azioni distruttive (discard, rimozione worktree, query che modificano dati) e i rilasci
che arrivano in produzione (qa → prod, catena) richiedono una conferma esplicita.

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
`DamnedIDE/src/shared/remote/protocol.ts`; vanno tenuti allineati). Lo stesso vale per
`src/shared/changeGroups.ts` (raggruppamento delle modifiche, gemello di quello dell'IDE).

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

### Firma dell'APK

Android installa un aggiornamento sopra l'app solo se l'APK è firmato con la **stessa chiave**
(altrimenti: «App non installata poiché il pacchetto è in conflitto con un pacchetto esistente»).
La CI firma con due secret del repository (Settings → Secrets and variables → Actions):

- `ANDROID_KEYSTORE_BASE64`: il `.jks` in base64
- `ANDROID_KEYSTORE_PASSWORD`: la sua password

`ANDROID_KEY_ALIAS` (default `damnedcloud`) e `ANDROID_KEY_PASSWORD` (default: la password del
keystore) servono solo per una chiave diversa. Una build su tag `v*` senza secret fallisce invece di
pubblicare un APK che non si aggiorna; le build di branch e PR senza secret usano la chiave di debug
del runner (warning nel log). Il primo passaggio alla chiave stabile richiede una disinstallazione.

Il passo «Check APK» stampa l'impronta SHA-256 del certificato: scrivila in
`android/signing-cert.sha256` e da lì in poi una release firmata con un'altra chiave fallisce.

```bash
# una volta sola; conserva il .jks e la password (password manager): senza, nessun aggiornamento si installa più
keytool -genkeypair -keystore damnedcloud.jks -storetype PKCS12 -alias damnedcloud -keyalg RSA -keysize 4096 -validity 36500 -dname "CN=DamnedCloud"
base64 -w0 damnedcloud.jks   # -> secret ANDROID_KEYSTORE_BASE64 (Windows: certutil -encode, poi togli le righe BEGIN/END)
```

Per una build locale installabile sopra quella della CI: `ANDROID_KEYSTORE_FILE` (percorso del
`.jks`) più le stesse variabili, come env o in `~/.gradle/gradle.properties`.

## Associazione

In DamnedIDE, **Impostazioni → Accesso remoto**, ci sono due procedure separate e tre QR, mostrati
uno alla volta e grandi (passo 1 → passo 2):

| Scheda | Passo 1 | Passo 2 |
|---|---|---|
| **App Android** | QR fisso per scaricare l'APK | QR di associazione `damnedcloud://pair?d=…` (generato, scade in 5 minuti) |
| **Browser (webapp)** | QR fisso con l'indirizzo della webapp (`http://<pc>:8765/`) | QR di associazione come link della webapp `http://<pc>:8765/#…` |

Il QR di associazione inquadrato con l'app Fotocamera del telefono apre direttamente DamnedCloud
(scheda App) o la webapp già associata (scheda Browser). In alternativa, nella pagina di associazione,
**Scansiona QR** lo legge: dal vivo dove il browser concede la fotocamera (l'app, una pagina https o
localhost), altrimenti (webapp in http sulla LAN) da una foto del QR. Sul desktop compare una richiesta
con un codice a 6 cifre da confermare.

La webapp aggiunta alla schermata Home (iPhone «Aggiungi a Home», app installata) ha uno storage suo,
separato dal browser: si associa da lì con **Scansiona QR** e una foto del QR (l'app Fotocamera aprirebbe
il browser). Conviene quindi aggiungerla alla Home prima di associarla.

## Aggiornamenti

- **App**: all'avvio e al ritorno in primo piano (al massimo ogni 6 ore) confronta la sua versione con
  l'ultima release su GitHub e propone **aggiorna**, che scarica l'APK; Android lo installa sopra la
  versione attuale, dati compresi. Verifica manuale in Impostazioni → Versioni.
- **Webapp**: è la build inclusa in DamnedIDE; quando l'IDE viene aggiornato, la pagina aperta si
  ricarica da sola alla riconnessione.

## Sicurezza

- Traffico cifrato dalla rete privata **Tailscale** (WireGuard).
- **Token per dispositivo** (salvato come hash sul PC), permessi per dispositivo,
  revoca singola o totale.
- Le credenziali SQL restano sul PC: il telefono usa solo connessioni già aperte.
- Il PAT di Azure DevOps resta sul PC: il bridge rilegge tutto prima di creare le PR e crea solo
  PR di promozione tra i branch develop / qa / prod (mai cancellati, policy mai bypassate).
- I percorsi file sono limitati al repository/worktree aperti.
