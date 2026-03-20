#!/usr/bin/env bash
#
# Download additional skyline/landmark photos to fill each city up to 5.
# Only downloads photos that don't already exist.

set -euo pipefail

PHOTO_DIR="photos/skylines"
cd "$(dirname "$0")/.."
mkdir -p "$PHOTO_DIR"

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
  sleep 0.4
}

echo "=== Downloading extra skyline photos (up to 5 per city) ==="
echo ""

# --- New York (has 0,1,2 — need 3,4) ---
echo "New York:"
download "new_york" 3 "photo-1518235506717-e1ed3306a89b"    # Empire State Building classic
download "new_york" 4 "photo-1546436836-07a91091f160"    # Manhattan sunset skyline

# --- Paris (has 0,1,2 — need 3,4) ---
echo "Paris:"
download "paris" 3 "photo-1431274172761-fca41d930114"       # Eiffel Tower from Trocadéro
download "paris" 4 "photo-1550340499-a6c60fc8287c"          # Sacré-Cœur Montmartre

# --- London (has 0,1,2 — need 3,4) ---
echo "London:"
download "london" 3 "photo-1526129318478-62ed807ebdf9"      # St Paul's Cathedral
download "london" 4 "photo-1533929736458-ca588d08c8be"      # Thames panorama sunset

# --- Tokyo (has 0,1,2 — need 3,4) ---
echo "Tokyo:"
download "tokyo" 3 "photo-1542051841857-5f90071e7989"       # Tokyo skyline with Mt Fuji
download "tokyo" 4 "photo-1480796927426-f609979314bd"       # Shibuya neon district

# --- Sydney (has 0,1 — need 2,3,4) ---
echo "Sydney:"
download "sydney" 2 "photo-1523482580672-f109ba8cb9be"      # Sydney Harbour panorama
download "sydney" 3 "photo-1528072164453-f4e8ef0d475a"      # Opera House at sunset
download "sydney" 4 "photo-1546268060-2592ff93ee24"         # Harbour Bridge close-up

# --- Dubai (has 0,1 — need 2,3,4) ---
echo "Dubai:"
download "dubai" 2 "photo-1526495124232-a04e1849168c"       # Dubai skyline from desert
download "dubai" 3 "photo-1582672060674-bc2bd808a8b5"       # Burj Al Arab
download "dubai" 4 "photo-1546412414-e1885259563a"          # Dubai Frame

# --- Hong Kong (has 0,1 — need 2,3,4) ---
echo "Hong Kong:"
download "hong_kong" 2 "photo-1506970845246-18f21d533b20"   # Victoria Peak view
download "hong_kong" 3 "photo-1594973782943-3b83190f3a58"   # Kowloon skyline
download "hong_kong" 4 "photo-1517144447511-aebb25bbc5fa"   # Harbour night panorama

# --- Singapore (has 0,1 — need 2,3,4) ---
echo "Singapore:"
download "singapore" 2 "photo-1565967511849-76a60a516170"   # Gardens by the Bay supertrees
download "singapore" 3 "photo-1508964942454-1a56651d54ac"   # Marina Bay skyline night
download "singapore" 4 "photo-1569288063643-5d29ad64df09"   # Merlion and skyline

# --- Rome (has 0,1,2 — need 3,4) ---
echo "Rome:"
download "rome" 3 "photo-1529260830199-42c24126f198"        # Trevi Fountain
download "rome" 4 "photo-1555992828-ca4dbe41d294"           # Rome panorama from Pincian Hill

# --- Barcelona (has 0,1 — need 2,3,4) ---
echo "Barcelona:"
download "barcelona" 2 "photo-1564221710304-0b37c8b9d729"   # Park Güell mosaic terrace
download "barcelona" 3 "photo-1523531294919-4bcd7c65ef33"   # Barcelona beach + W Hotel
download "barcelona" 4 "photo-1579282240050-352db0a14c21"   # Gothic Quarter

# --- San Francisco (has 0,1 — need 2,3,4) ---
echo "San Francisco:"
download "san_francisco" 2 "photo-1549346155-14a96e1c2e26" # Painted Ladies
download "san_francisco" 3 "photo-1534050359320-02900022571e" # Golden Gate fog
download "san_francisco" 4 "photo-1541464522988-31b829128abd" # SF from Alcatraz

# --- Chicago (has 0,1 — need 2,3,4) ---
echo "Chicago:"
download "chicago" 2 "photo-1524168948265-a546616d4e97"     # Chicago River + bridges
download "chicago" 3 "photo-1501446529957-6226bd447c46"     # Skyline at golden hour
download "chicago" 4 "photo-1581373449483-37449f962b6c"     # Millennium Park aerial

# --- Istanbul (has 0,1 — need 2,3,4) ---
echo "Istanbul:"
download "istanbul" 2 "photo-1527838832700-5059252407fa"    # Blue Mosque
download "istanbul" 3 "photo-1570939274717-7eda259b50ed"    # Bosphorus Bridge sunset
download "istanbul" 4 "photo-1545459720-aac8509eb02c"       # Grand Bazaar interior

# --- Rio de Janeiro (has 0,1 — need 2,3,4) ---
echo "Rio de Janeiro:"
download "rio" 2 "photo-1516306580123-e6e52b1b7b5f"         # Copacabana beach aerial
download "rio" 3 "photo-1544989164-31dc3291c654"            # Sugarloaf cable car
download "rio" 4 "photo-1551449788-67e5e2339064"            # Rio panorama from Niterói

# --- Cairo (has 0,1 — need 2,3,4) ---
echo "Cairo:"
download "cairo" 2 "photo-1553913861-c0fddf2619ee"          # Pyramids with camels
download "cairo" 3 "photo-1539768942893-daf53e736b68"       # Cairo citadel mosque
download "cairo" 4 "photo-1562979314-bee7453e911c"          # Nile River at dusk

# --- Shanghai (has 0,1 — need 2,3,4) ---
echo "Shanghai:"
download "shanghai" 2 "photo-1545893835-abaa50cbe628"       # Bund at night
download "shanghai" 3 "photo-1517309230475-12788889f044"    # Oriental Pearl Tower
download "shanghai" 4 "photo-1563503773675-2b8a40218bf8"    # Pudong from river

# --- Moscow (has 0,1 — need 2,3,4) ---
echo "Moscow:"
download "moscow" 2 "photo-1520106212299-d99c443e4568"      # Kremlin walls + river
download "moscow" 3 "photo-1561542320-9a18cd340e98"         # Moscow University
download "moscow" 4 "photo-1548834925-e48f8a27ae34"         # Cathedral of Christ the Saviour

# --- Buenos Aires (has 0,1 — need 2,3,4) ---
echo "Buenos Aires:"
download "buenos_aires" 2 "photo-1579437545872-4e1a1fc4d4fd" # Casa Rosada
download "buenos_aires" 3 "photo-1564580748053-e86fe82d6b7a" # Buenos Aires skyline wide
download "buenos_aires" 4 "photo-1588007375246-32e19cee5e20" # Recoleta Cemetery

# --- Bangkok (has 0,1 — need 2,3,4) ---
echo "Bangkok:"
download "bangkok" 2 "photo-1534008897995-27a23e859048"     # Bangkok skyline sunset
download "bangkok" 3 "photo-1562602833-0f4ab2fc46e3"        # Reclining Buddha Wat Pho
download "bangkok" 4 "photo-1583394838336-acd977736f90"     # Chao Phraya River temples

# --- Venice (has 0,1 — need 2,3,4) ---
echo "Venice:"
download "venice" 2 "photo-1534113414509-0eec2bfb493f"      # St Mark's Square
download "venice" 3 "photo-1516483638261-f4dbaf036963"       # Venice canals aerial
download "venice" 4 "photo-1558005137-d9619a5c539f"         # Bridge of Sighs

# --- Prague (has 0,1 — need 2,3,4) ---
echo "Prague:"
download "prague" 2 "photo-1562624475-96c2bc08fab9"         # Old Town astronomical clock
download "prague" 3 "photo-1558642452-9d2a7deb7f62"         # Prague Castle at golden hour
download "prague" 4 "photo-1600623471616-8c1966c91ff6"      # Vltava River + bridges

# --- Cape Town (has 0,1 — need 2,3,4) ---
echo "Cape Town:"
download "cape_town" 2 "photo-1578528425555-11be43ebbf9c"   # Bo-Kaap colorful houses
download "cape_town" 3 "photo-1591280063444-d3c514eb6e13"   # Cape Point lighthouse
download "cape_town" 4 "photo-1552425969-fb3a39e3a226"      # Table Mountain cable car

# --- Kyoto (has 0,1 — need 2,3,4) ---
echo "Kyoto:"
download "kyoto" 2 "photo-1528360983277-13d401cdc186"       # Bamboo grove Arashiyama
download "kyoto" 3 "photo-1524413840807-0c3cb6fa808d"       # Kyoto pagoda + cherry blossoms
download "kyoto" 4 "photo-1558862107-d49ef2a04d72"          # Geisha district Gion

# --- Athens (has 0,1 — need 2,3,4) ---
echo "Athens:"
download "athens" 2 "photo-1555993539-1732b0258235"         # Acropolis wide
download "athens" 3 "photo-1608036066262-56339651d28c"      # Ancient Agora columns
download "athens" 4 "photo-1575036501199-9ceb8741bfad"      # Athens panorama sunset

# --- Havana (has 0,1 — need 2,3,4) ---
echo "Havana:"
download "havana" 2 "photo-1564931535687-2deeac3dd8b8"      # Classic car + colonial street
download "havana" 3 "photo-1570299437522-3e1a2c2ef569"      # Capitol Building
download "havana" 4 "photo-1559060015-7954f7f75993"         # Havana rooftop panorama

# --- Marrakech (has 0,1 — need 2,3,4) ---
echo "Marrakech:"
download "marrakech" 2 "photo-1560095633-437cd7286c2f"      # Bahia Palace
download "marrakech" 3 "photo-1534680783089-0f7b2ea47e6c"   # Medina rooftops + Atlas
download "marrakech" 4 "photo-1572025442646-866d16c84a54"   # Marrakech souk

# --- Seoul (has 0,1 — need 2,3,4) ---
echo "Seoul:"
download "seoul" 2 "photo-1546874177-9e664107314e"          # Bukchon hanok village
download "seoul" 3 "photo-1583400860437-a98ccd5cb208"       # Lotte Tower + skyline
download "seoul" 4 "photo-1548115184-bc6544d06a58"          # Namsan Tower night

# --- Amsterdam (has 0,1 — need 2,3,4) ---
echo "Amsterdam:"
download "amsterdam" 2 "photo-1512470876562-1bd089d5880e"   # Canal houses + bikes
download "amsterdam" 3 "photo-1576924542622-772281b13aa8"   # Westerkerk church
download "amsterdam" 4 "photo-1558618666-fcd25c85f82e"      # Prinsengracht evening

# --- Mumbai (has 0,1 — need 2,3,4) ---
echo "Mumbai:"
download "mumbai" 2 "photo-1566552881560-0be862a7c445"      # Chhatrapati Shivaji Terminus
download "mumbai" 3 "photo-1595658658481-d53d3f999875"      # Haji Ali mosque
download "mumbai" 4 "photo-1562979314-bee7453e911c"         # Mumbai skyline panorama

# --- Mexico City (has 0,1 — need 2,3,4) ---
echo "Mexico City:"
download "mexico_city" 2 "photo-1585515362321-76d66666c40a" # Zócalo plaza
download "mexico_city" 3 "photo-1574491099925-fd99789ae1a5" # Chapultepec Castle
download "mexico_city" 4 "photo-1567610310553-3f0f22d53fe1" # CDMX skyline wide

echo ""
echo "=== Download complete ==="
echo ""

total=$(find "$PHOTO_DIR" -name "*.jpg" | wc -l | tr -d ' ')
cities=$(find "$PHOTO_DIR" -name "*_0.jpg" | wc -l | tr -d ' ')
echo "Total photos: $total across $cities cities"
