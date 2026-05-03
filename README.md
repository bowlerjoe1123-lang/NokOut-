# Pokemon Pack Simulator

Simple local browser app that opens 10-card Pokemon booster-style packs from a downloaded card catalog.

## Files

- `index.html`: the simulator UI
- `app.js`: pack logic and collection tracking
- `styles.css`: page styling
- `scripts/download-cards.ps1`: downloads the card catalog into `data/cards.js`

## Refresh the card catalog

Run this in PowerShell from the project folder:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\download-cards.ps1
```

That script downloads card metadata from the Pokemon TCG API and writes:

- `data/cards.json`
- `data/cards.js`

The full local catalog is downloaded, while card art is loaded from the Pokemon TCG image URLs on demand so the project does not balloon into a multi-gigabyte image dump.

## Open the simulator

After the data download finishes, open `index.html` in your browser.

If you want the page to auto-open packs on launch, add a query string such as `index.html?packs=1` or `index.html?packs=5`.

## Pack rules

Each pack opens with this simple layout:

- 6 common cards
- 3 uncommon cards
- 1 rare-or-better card
