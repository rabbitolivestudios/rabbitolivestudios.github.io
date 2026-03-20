#!/usr/bin/env bash
#
# Download reference skyline/landmark photos from Unsplash.
# Unsplash photos are free to use (https://unsplash.com/license).
# Used as reference input for FLUX.2 artistic reinterpretation.
#
# Usage: bash scripts/download-skyline-photos.sh
#
# Each city gets 2-3 photos: mix of skyline panoramas and landmark close-ups.

set -euo pipefail

PHOTO_DIR="photos/skylines"
cd "$(dirname "$0")/.."
mkdir -p "$PHOTO_DIR"

# Unsplash direct image URL — w=768 for FLUX.2 reference input
U="https://images.unsplash.com"

download() {
  local key="$1"
  local idx="$2"
  local photo_id="$3"
  local out="${PHOTO_DIR}/${key}_${idx}.jpg"

  if [ -f "$out" ]; then
    echo "  SKIP ${key}_${idx} (exists)"
    return 0
  fi

  echo "  GET  ${key}_${idx}"
  if curl -sL --max-time 20 --fail -o "$out" "${U}/${photo_id}?w=768&q=80&fit=crop" 2>/dev/null; then
    local size=$(wc -c < "$out" | tr -d ' ')
    echo "  OK   ${key}_${idx} (${size} bytes)"
  else
    rm -f "$out"
    echo "  FAIL ${key}_${idx}"
  fi
  sleep 0.3  # gentle rate limit
}

echo "=== Downloading skyline reference photos from Unsplash ==="
echo ""

# --- New York ---
echo "New York:"
download "new_york" 0 "photo-1534430480872-3498386e7856"    # Manhattan skyline from Brooklyn
download "new_york" 1 "photo-1496442226666-8d4d0e62e6e9"    # Statue of Liberty
download "new_york" 2 "photo-1522083165195-3424ed129620"    # Brooklyn Bridge

# --- Paris ---
echo "Paris:"
download "paris" 0 "photo-1502602898657-3e91760cbb34"       # Eiffel Tower sunset
download "paris" 1 "photo-1499856871958-5b9627545d1a"       # Paris skyline panorama
download "paris" 2 "photo-1478391679764-b2d8b3cd1e94"       # Notre-Dame cathedral

# --- London ---
echo "London:"
download "london" 0 "photo-1513635269975-59663e0ac1ad"      # London skyline with Tower Bridge
download "london" 1 "photo-1529655683826-aba9b3e77383"      # Big Ben / Elizabeth Tower
download "london" 2 "photo-1486299267070-83823f5448dd"      # Tower Bridge at night

# --- Tokyo ---
echo "Tokyo:"
download "tokyo" 0 "photo-1540959733332-eab4deabeeaf"       # Tokyo Tower city view
download "tokyo" 1 "photo-1536098561742-ca998e48cbcc"       # Senso-ji temple
download "tokyo" 2 "photo-1503899036084-c55cdd92da26"       # Shibuya crossing

# --- Sydney ---
echo "Sydney:"
download "sydney" 0 "photo-1506973035872-a4ec16b8e8d9"      # Opera House + Harbour Bridge
download "sydney" 1 "photo-1524293581917-878a6d017c71"      # Opera House close-up

# --- Dubai ---
echo "Dubai:"
download "dubai" 0 "photo-1512453979798-5ea266f8880c"       # Dubai skyline Burj Khalifa
download "dubai" 1 "photo-1518684079-3c830dcef090"          # Dubai Marina skyline

# --- Hong Kong ---
echo "Hong Kong:"
download "hong_kong" 0 "photo-1536599018102-9f803c979b13"   # Victoria Harbour panorama
download "hong_kong" 1 "photo-1507941097613-9f2157b69235"   # Hong Kong skyline night

# --- Singapore ---
echo "Singapore:"
download "singapore" 0 "photo-1525625293386-3f8f99389edd"   # Marina Bay Sands
download "singapore" 1 "photo-1496939376851-89342e90adcd"   # Singapore skyline

# --- Rome ---
echo "Rome:"
download "rome" 0 "photo-1552832230-c0197dd311b5"           # Colosseum
download "rome" 1 "photo-1531572753322-ad063cecc140"        # St Peter's Basilica
download "rome" 2 "photo-1515542622106-78bda8ba0e5b"        # Roman Forum

# --- Barcelona ---
echo "Barcelona:"
download "barcelona" 0 "photo-1583422409516-2895a77efded"   # Sagrada Familia
download "barcelona" 1 "photo-1539037116277-4db20889f2d4"   # Barcelona skyline

# --- San Francisco ---
echo "San Francisco:"
download "san_francisco" 0 "photo-1501594907352-04cda38ebc29"  # Golden Gate Bridge
download "san_francisco" 1 "photo-1521747116042-5a810fda9664"  # SF skyline from bay

# --- Chicago ---
echo "Chicago:"
download "chicago" 0 "photo-1494522855154-9297ac14b55f"     # Chicago skyline lakefront
download "chicago" 1 "photo-1477959858617-67f85cf4f1df"     # Cloud Gate / The Bean

# --- Istanbul ---
echo "Istanbul:"
download "istanbul" 0 "photo-1524231757912-21f4fe3a7200"    # Istanbul skyline with mosques
download "istanbul" 1 "photo-1541432901042-2d8bd64b4a9b"    # Hagia Sophia

# --- Rio de Janeiro ---
echo "Rio de Janeiro:"
download "rio" 0 "photo-1483729558449-99ef09a8c325"         # Christ the Redeemer aerial
download "rio" 1 "photo-1518639192441-8fce0a366e2e"         # Sugarloaf Mountain + bay

# --- Cairo ---
echo "Cairo:"
download "cairo" 0 "photo-1503177119275-0aa32b3a9368"       # Pyramids of Giza
download "cairo" 1 "photo-1572252009286-268acec5ca0a"       # Great Sphinx

# --- Shanghai ---
echo "Shanghai:"
download "shanghai" 0 "photo-1538428494232-9c0d8a3ab403"    # Pudong skyline / The Bund
download "shanghai" 1 "photo-1474181628669-e4be02e7f72c"    # Oriental Pearl Tower

# --- Moscow ---
echo "Moscow:"
download "moscow" 0 "photo-1513326738677-b964603b136d"      # St. Basil's Cathedral / Red Square
download "moscow" 1 "photo-1547448415-e9f5b28e570d"         # Moscow skyline

# --- Buenos Aires ---
echo "Buenos Aires:"
download "buenos_aires" 0 "photo-1589909202802-8f4aadce1849"   # Obelisco + 9 de Julio
download "buenos_aires" 1 "photo-1612294037637-ec328d0e075e"   # La Boca colorful houses

# --- Bangkok ---
echo "Bangkok:"
download "bangkok" 0 "photo-1563492065599-3520f775eeed"     # Wat Arun temple
download "bangkok" 1 "photo-1508009603885-50cf7c579365"     # Grand Palace

# --- Venice ---
echo "Venice:"
download "venice" 0 "photo-1523906834658-6e24ef2386f9"      # Grand Canal
download "venice" 1 "photo-1514890547357-a9ee288728e0"      # Rialto Bridge

# --- Prague ---
echo "Prague:"
download "prague" 0 "photo-1519677100203-a0e668c92439"      # Prague skyline / Charles Bridge
download "prague" 1 "photo-1541849546-216549ae216d"         # Prague Castle panorama

# --- Cape Town ---
echo "Cape Town:"
download "cape_town" 0 "photo-1580060839134-75a5edca2e99"   # Table Mountain
download "cape_town" 1 "photo-1576485290814-1c72aa4bbb8e"   # Cape Town waterfront

# --- Kyoto ---
echo "Kyoto:"
download "kyoto" 0 "photo-1493976040374-85c8e12f0c0e"       # Fushimi Inari torii gates
download "kyoto" 1 "photo-1545569341-9eb8b30979d9"          # Kinkaku-ji golden temple

# --- Athens ---
echo "Athens:"
download "athens" 0 "photo-1555993539-1732b0258235"         # Acropolis panorama
download "athens" 1 "photo-1603565816030-6b389eeb23cb"      # Parthenon close-up

# --- Havana ---
echo "Havana:"
download "havana" 0 "photo-1500759285222-a95626b934cb"      # Havana Malecón + skyline
download "havana" 1 "photo-1570299437522-3e1a2c2ef569"      # Classic car + colonial street

# --- Marrakech ---
echo "Marrakech:"
download "marrakech" 0 "photo-1597212618440-806262de4f6b"   # Koutoubia Mosque
download "marrakech" 1 "photo-1489749798305-4fea3ae63d43"   # Djemaa el-Fna market

# --- Seoul ---
echo "Seoul:"
download "seoul" 0 "photo-1534274988757-a28bf1a57c17"       # Seoul skyline with N Tower
download "seoul" 1 "photo-1517154421773-0529f29ea451"       # Gyeongbokgung Palace

# --- Amsterdam ---
echo "Amsterdam:"
download "amsterdam" 0 "photo-1534351590666-13e3e96b5017"   # Canal houses
download "amsterdam" 1 "photo-1583037189850-1921ae7c6c22"   # Rijksmuseum + canal

# --- Mumbai ---
echo "Mumbai:"
download "mumbai" 0 "photo-1529253355930-ddbe423a2ac7"      # Gateway of India
download "mumbai" 1 "photo-1570168007204-dfb528c6958f"      # Marine Drive skyline

# --- Mexico City ---
echo "Mexico City:"
download "mexico_city" 0 "photo-1518105779142-d975f22f1b0a" # Angel of Independence
download "mexico_city" 1 "photo-1585464231875-d9ef1f5ad396" # Palacio de Bellas Artes

echo ""
echo "=== Download complete ==="
echo ""

# Count photos
total=$(find "$PHOTO_DIR" -name "*.jpg" | wc -l | tr -d ' ')
cities=$(find "$PHOTO_DIR" -name "*_0.jpg" | wc -l | tr -d ' ')
echo "Total photos: $total across $cities cities"
echo ""
echo "To upload to R2, run:"
echo "  bash scripts/upload-skyline-photos.sh"
