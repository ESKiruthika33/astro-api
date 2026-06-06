// ============================================================
//  Astrology Backend — Node.js + swisseph + express
//  STEP 1: npm install express cors swisseph luxon node-fetch
//  STEP 2: node server.js
//  API runs at: http://localhost:3001
// ============================================================

const express  = require("express");
const cors     = require("cors");
const sweph    = require("swisseph");
const { DateTime } = require("luxon");

const app  = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// Path to your ephe/ folder (must contain sepl_18.se1, semo_18.se1, seas_18.se1)
sweph.set_ephe_path("./ephe");

// ── Constants ───────────────────────────────────────────────

const SIGNS = [
  "Aries","Taurus","Gemini","Cancer","Leo","Virgo",
  "Libra","Scorpio","Sagittarius","Capricorn","Aquarius","Pisces"
];

const PLANETS = [
  { id: sweph.SE_SUN,       name: "Sun"     },
  { id: sweph.SE_MOON,      name: "Moon"    },
  { id: sweph.SE_MERCURY,   name: "Mercury" },
  { id: sweph.SE_VENUS,     name: "Venus"   },
  { id: sweph.SE_MARS,      name: "Mars"    },
  { id: sweph.SE_JUPITER,   name: "Jupiter" },
  { id: sweph.SE_SATURN,    name: "Saturn"  },
  { id: sweph.SE_URANUS,    name: "Uranus"  },
  { id: sweph.SE_NEPTUNE,   name: "Neptune" },
  { id: sweph.SE_PLUTO,     name: "Pluto"   },
  { id: sweph.SE_TRUE_NODE, name: "Rahu"    },
];

// ── Helpers ─────────────────────────────────────────────────

function lonToSign(lon) {
  const norm = ((lon % 360) + 360) % 360;
  return {
    sign:   SIGNS[Math.floor(norm / 30)],
    degree: parseFloat((norm % 30).toFixed(2))
  };
}

function toJulianDay(utcDT) {
  return sweph.julday(
    utcDT.year,
    utcDT.month,
    utcDT.day,
    utcDT.hour + utcDT.minute / 60 + utcDT.second / 3600,
    sweph.SE_GREG_CAL
  );
}

function getPlanetPosition(jd, planetId) {
  const flags  = sweph.SEFLG_SWIEPH | sweph.SEFLG_SPEED;
  const result = sweph.calc_ut(jd, planetId, flags);
  if (result.error) throw new Error(result.error);
  return result.longitude;
}

function getHouses(jd, lat, lon, system) {
  // P = Placidus  W = Whole Sign  K = Koch  E = Equal
  const result = sweph.houses(jd, lat, lon, system.charCodeAt(0));
  if (result.error) throw new Error(result.error);
  return {
    cusps:     result.house,
    ascendant: result.ascendant,
    mc:        result.mc,
  };
}

// ── Routes ───────────────────────────────────────────────────

/**
 * POST /chart
 * Body: { date, time, lat, lon, tz, houseSystem }
 */
app.post("/chart", (req, res) => {
  try {
    const { date, time, lat, lon, tz, houseSystem = "P" } = req.body;

    if (!date || lat == null || lon == null || !tz) {
      return res.status(400).json({ error: "date, lat, lon and tz are required." });
    }

    // Convert local birth time → UTC using the real timezone (handles DST)
    const localDT = DateTime.fromISO(date + "T" + (time || "12:00"), { zone: tz });
    if (!localDT.isValid) {
      return res.status(400).json({ error: "Invalid date/time or timezone: " + localDT.invalidExplanation });
    }
    const utcDT = localDT.toUTC();
    const jd    = toJulianDay(utcDT);

    // Planetary positions (Swiss Ephemeris)
    const planets = {};
    for (const p of PLANETS) {
      const longitude = getPlanetPosition(jd, p.id);
      planets[p.name] = { longitude: parseFloat(longitude.toFixed(4)), ...lonToSign(longitude) };
    }

    // Ketu = Rahu + 180°
    const ketuLon = (planets["Rahu"].longitude + 180) % 360;
    planets["Ketu"] = { longitude: parseFloat(ketuLon.toFixed(4)), ...lonToSign(ketuLon) };

    // House cusps + Ascendant + MC (Placidus by default)
    const houses  = getHouses(jd, lat, lon, houseSystem);
    const ascInfo = lonToSign(houses.ascendant);
    const mcInfo  = lonToSign(houses.mc);

    const houseCusps = houses.cusps.slice(1).map((c, i) => ({
      house:     i + 1,
      longitude: parseFloat(c.toFixed(4)),
      ...lonToSign(c)
    }));

    res.json({
      meta: {
        utc:         utcDT.toISO(),
        julianDay:   parseFloat(jd.toFixed(6)),
        lat, lon, tz, houseSystem,
      },
      planets,
      ascendant: { longitude: parseFloat(houses.ascendant.toFixed(4)), ...ascInfo },
      mc:        { longitude: parseFloat(houses.mc.toFixed(4)), ...mcInfo },
      houses:    houseCusps,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /timezone?lat=XX&lon=YY
 * Returns IANA timezone string for any coordinate
 */
app.get("/timezone", async (req, res) => {
  try {
    const { lat, lon } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: "lat and lon required" });

    const fetch = (await import("node-fetch")).default;
    const url   = "https://api.open-meteo.com/v1/forecast?latitude=" + lat +
                  "&longitude=" + lon + "&timezone=auto&forecast_days=1&hourly=temperature_2m";
    const data  = await (await fetch(url)).json();

    res.json({
      timezone:  data.timezone,
      utcOffset: data.utc_offset_seconds / 3600,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /health  — check the server is running
 */
app.get("/health", (_, res) => {
  res.json({ status: "ok", swissEphemerisVersion: sweph.version() });
});

// ── Start ────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log("🔮 Astrology API running at http://localhost:" + PORT);
  console.log("   Swiss Ephemeris version: " + sweph.version());
  console.log("   Ephemeris files path: ./ephe");
});
