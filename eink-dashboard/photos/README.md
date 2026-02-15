# Birthday Portrait Photos

Place reference photos here for the birthday easter egg feature.
Photos are uploaded to R2 and used by FLUX.2 to generate artistic portraits.

## Naming convention

```
portraits/{key}_0.jpg   (required — primary photo)
portraits/{key}_1.jpg   (optional — additional angle)
portraits/{key}_2.jpg   (optional)
portraits/{key}_3.jpg   (optional — max 4 per person)
```

Single photo also works: `portraits/{key}.jpg`

## Requirements

- JPEG format
- Resized to **512x512 or smaller** (FLUX.2 requirement)
- Clear face, good lighting

## People keys

| Key        | Name        |
|------------|-------------|
| thiago     | Thiago      |
| gilmara    | Gilmara     |
| joaopedro  | João Pedro  |
| lucas      | Lucas       |
| sonia      | Sônia       |
| alvaro     | Álvaro      |
| mariana    | Mariana     |
| theo       | Theo        |
| teteu      | Teteu       |

## Upload

```bash
npm run upload-photos
```
