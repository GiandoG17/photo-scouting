# Foto Recap

App privata per i sopralluoghi: carichi le foto dal telefono, l'app le divide per location, e genera il PDF "Location Proposals" in stile Squalo con mappa dei punti e link per scaricare le foto di ogni location.

## Avvio

```bash
npm install
npm start
```

Apri `http://localhost:3210`. Dal telefono, sulla stessa Wi-Fi, usa l'indirizzo che il server stampa all'avvio (es. `http://192.168.1.20:3210`). Da Safari puoi fare "Aggiungi a Home" per averla come app.

## Come funziona

1. **Nuovo sopralluogo**: nome progetto, cliente, contatti. Casa di produzione, email e telefono sono già compilati con i dati Squalo (modificabili, o cambiabili di default con `DEFAULT_COMPANY`, `DEFAULT_EMAIL`, `DEFAULT_PHONE`).
2. **Carica le foto**: "Seleziona foto" dalla galleria, oppure "Seleziona cartella" (o trascina una cartella) e l'app cerca da sola le foto in tutte le sottocartelle, ignorando file nascosti e non immagini. Per ogni foto legge GPS e ora di scatto (anche HEIC da iPhone).
   * foto entro 150 m una dall'altra: stessa location
   * foto senza GPS: finiscono nella location della foto scattata più vicina nel tempo (entro 30 min)
   * il nome viene suggerito da OpenStreetMap (es. "Piazza Fontana")
3. **Controlla le location**: rinomina, imposta stato (Available / TBC / Not available), link per il cliente, ordina.
   * **trascina le foto** da una location all'altra, o su "nuova location" (sul telefono: tieni premuto e trascina). Se ne selezioni più di una si spostano insieme
   * **posizione a mano** per le location senza GPS (o per correggerla): scrivi un indirizzo ("Piazza Fontana, Milano"), delle coordinate ("45.4636, 9.1959") o incolla un link di Google Maps. Finisce in mappa e in "Open in Maps"
   * tocca le foto per selezionarle, sceglierne la copertina o eliminarle
4. **Genera**: crea uno zip con gli originali per ogni location e il PDF con **tutte** le foto:
   copertina con logo, mappa con i punti numerati e legenda cliccabile, pagina "LOCATION PROPOSALS", per ogni location la foto grande con titolo e stato (es. "LOCATION ONE - PIAZZA DUOMO / AVAILABLE"), link a Google Maps e la galleria con le altre foto (6 per pagina, su più pagine se servono), pagina finale con contatti.

## Link nel PDF

Il PDF non contiene mai link all'app. Le immagini non sono cliccabili. In alto a destra di una location compare "Click here for more" solo se le hai messo un link:

1. dopo "Genera" scarica dall'app lo zip di quella location
2. caricalo su Google Drive, WeTransfer, Dropbox o simili
3. incolla il link nel campo "Link foto per il cliente" della location e rigenera il PDF

Senza link la scritta non compare. "Open in Maps" punta sempre a Google Maps.

## Uso fuori casa

Per usarla dal telefono fuori dalla Wi-Fi di casa, mettila su un piccolo server (VPS, Render, Railway, Fly con disco persistente per `data/`) o esponila con un tunnel (`cloudflared tunnel --url http://localhost:3210`), sempre con una password:

```bash
APP_PASSWORD=unapassword npm start
```

Con `APP_PASSWORD` tutta l'app, compresi i download, si apre da una pagina di accesso con la password. L'accesso resta valido 90 giorni sul dispositivo; "Esci" in alto nella pagina dei progetti.

## Configurazione

| Variabile | Default | |
|---|---|---|
| `PORT` | `3210` | porta |
| `APP_PASSWORD` | nessuna | protegge l'app |
| `DEFAULT_COMPANY` / `DEFAULT_EMAIL` / `DEFAULT_PHONE` | dati Squalo | precompilati nei nuovi progetti |
| `DATA_DIR` | `./data` | dove salvare foto e output |
| `CLUSTER_RADIUS_M` | `150` | distanza massima tra foto della stessa location |
| `CLUSTER_GAP_MIN` | `30` | minuti per agganciare le foto senza GPS |
| `GEOCODE` | `on` | `off` per non inviare coordinate a OpenStreetMap |
| `MAP_TILE_URL` | tile OpenStreetMap | sorgente tile della mappa |

Il logo di default della copertina è `assets/logo.png`; ogni progetto può caricarne uno diverso da "Dati del PDF".

## Note

* Se dal telefono le foto arrivano senza GPS (iOS a volte toglie la posizione quando carichi da Safari), le location vengono comunque create per orario di scatto. Per avere il GPS: nel selettore foto di iOS tocca "Opzioni" e attiva "Posizione", oppure passa le foto sul Mac (AirDrop) e caricale da lì.
* I font standard del PDF (Helvetica) coprono le lettere accentate italiane; caratteri più esotici perdono l'accento.
