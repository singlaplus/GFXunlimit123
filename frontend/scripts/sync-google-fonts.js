const fs = require("fs");
const path = require("path");

const FILE_PATH = path.join(__dirname, "..", "src", "data", "googleFonts.js");
const LICENSED_FAMILIES = new Set([
  "ABeeZee",
  "Abel",
  "Alegreya",
  "Alegreya Sans",
  "Aleo",
  "Alice",
  "Allerta",
  "Allerta Stencil",
  "Amatic SC",
  "Amiri",
  "Andika",
  "Anton",
  "Archivo",
  "Archivo Black",
  "Arimo",
  "Arvo",
  "Asap",
  "Assistant",
  "B612",
  "B612 Mono",
  "Barlow",
  "Barlow Condensed",
  "Bebas Neue",
  "Bitter",
  "Bree Serif",
  "Cabin",
  "Cairo",
  "Cantarell",
  "Cardo",
  "Chivo",
  "Cinzel",
  "Comfortaa",
  "Cormorant Garamond",
  "Crimson Pro",
  "Crimson Text",
  "DM Sans",
  "DM Serif Display",
  "Dancing Script",
  "EB Garamond",
  "Exo 2",
  "Fira Code",
  "Fira Sans",
  "Frank Ruhl Libre",
  "Fraunces",
  "Gelasio",
  "Gentium Basic",
  "Gentium Book Basic",
  "Gloria Hallelujah",
  "Heebo",
  "Hind",
  "IBM Plex Mono",
  "IBM Plex Sans",
  "Inconsolata",
  "Inter",
  "Josefin Sans",
  "Jost",
  "Karla",
  "Lato",
  "Libre Baskerville",
  "Libre Franklin",
  "Lora",
  "M PLUS 1",
  "Merriweather",
  "Merriweather Sans",
  "Montserrat",
  "Nanum Gothic",
  "Noto Sans",
  "Noto Serif",
  "Nunito",
  "Open Sans",
  "Oswald",
  "Overpass",
  "Poppins",
  "PT Sans",
  "PT Serif",
  "Playfair Display",
  "Plus Jakarta Sans",
  "Quicksand",
  "Raleway",
  "Roboto",
  "Roboto Condensed",
  "Roboto Mono",
  "Roboto Slab",
  "Rubik",
  "Sora",
  "Source Sans 3",
  "Source Serif 4",
  "Space Grotesk",
  "Spectral",
  "Tajawal",
  "Teko",
  "Titillium Web",
  "Ubuntu",
  "Ubuntu Condensed",
  "Varela Round",
  "Vollkorn",
  "Work Sans",
  "Yanone Kaffeesatz",
]);

const fetchGoogleFonts = async () => {
  const response = await fetch("https://fonts.google.com/metadata?key=material_symbols&incomplete=true");
  if (!response.ok) {
    throw new Error(`Unable to fetch Google Fonts metadata (${response.status})`);
  }

  const text = await response.text();
  const payload = JSON.parse(text.replace(")]}'", ""));
  const families = Array.isArray(payload?.familyMetadataList) ? payload.familyMetadataList : [];

  return families
    .map((family) => family?.family)
    .filter(Boolean)
    .filter((family) => LICENSED_FAMILIES.has(family))
    .sort((a, b) => a.localeCompare(b));
};

(async () => {
  try {
    const families = await fetchGoogleFonts();
    const content = `export const GOOGLE_FONT_FAMILIES = ${JSON.stringify(families, null, 2)};\n\nexport const GOOGLE_FONT_CSS_URL = \`https://fonts.googleapis.com/css2?family=${"${"}GOOGLE_FONT_FAMILIES.map((font) => font.replace(/\\s+/g, "+")).join("&family=")}${"}"}&display=swap\`;\nexport const GOOGLE_FONT_SYNC_LABEL = "Monthly open-source Google font sync";\n`;
    fs.writeFileSync(FILE_PATH, content, "utf8");
    console.log(`Synced ${families.length} free/open-source Google font families.`);
  } catch (error) {
    console.error("Google font sync failed:", error.message);
    process.exitCode = 1;
  }
})();
