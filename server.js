const express      = require("express");
const { DateTime } = require("luxon");

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  next();
});
app.use(express.json());

// ── Constants ───────────────────────────────────────────────

const SIGNS = [
  "Aries","Taurus","Gemini","Cancer","Leo","Virgo",
  "Libra","Scorpio","Sagittarius","Capricorn","Aquarius","Pisces"
];

// ── Pure JS Astronomy Math ──────────────────────────────────

function lonToSign(lon) {
  const norm = ((lon % 360) + 360) % 360;
  return { sign: SIGNS[Math.floor(norm / 30)], degree: parseFloat((norm % 30).toFixed(2)) };
}

function toJD(utcDT) {
  return 2451545.0 + (utcDT.toMillis() - 946727935816) / 86400000;
}

function getSunLon(jd) {
  const T  = (jd - 2451545.0) / 36525;
  const L0 = (280.46646 + 36000.76983 * T) % 360;
  const M  = ((357.52911 + 35999.05029 * T) % 360) * Math.PI / 180;
  const C  = (1.914602 - 0.004817 * T) * Math.sin(M)
           + 0.019993 * Math.sin(2 * M)
           + 0.000289 * Math.sin(3 * M);
  return ((L0 + C) % 360 + 360) % 360;
}

function getMoonLon(jd) {
  const T = (jd - 2451545.0) / 36525;
  const L = (218.3165 + 481267.8813 * T) % 360;
  const M = ((134.9634 + 477198.8676 * T) % 360) * Math.PI / 180;
  const F = ((93.2721  + 483202.0175 * T) % 360) * Math.PI / 180;
  const D = ((297.8502 + 445267.1115 * T) % 360) * Math.PI / 180;
  const Ms= ((357.5291 + 35999.0503  * T) % 360) * Math.PI / 180;
  const c = 6.289 * Math.sin(M)
          - 1.274 * Math.sin(2*D - M)
          + 0.658 * Math.sin(2*D)
          - 0.214 * Math.sin(2*M)
          - 0.114 * Math.sin(2*F)
          + 0.059 * Math.sin(2*D - 2*Ms)
          - 0.057 * Math.sin(2*D - M - Ms);
  return ((L + c) % 360 + 360) % 360;
}

function getPlanetLon(jd, planet) {
  const T = (jd - 2451545.0) / 36525;
  const table = {
    Mercury: [252.2509, 149472.6746],
    Venus:   [181.9798,  58517.8157],
    Mars:    [355.4330,  19140.2993],
    Jupiter: [ 34.3515,   3034.9057],
    Saturn:  [ 50.0774,   1222.1138],
    Uranus:  [314.0550,    428.4882],
    Neptune: [304.3487,    218.4862],
    Pluto:   [238.9290,    144.9600],
  };
  const p = table[planet];
  return p ? ((p[0] + p[1] * T) % 360 + 360) % 360 : 0;
}

function getRahuLon(jd) {
  const T = (jd - 2451545.0) / 36525;
  return ((125.0445 - 1934.1363 * T) % 360 + 360) % 360;
}

function getAscendant(jd, latDeg, lonDeg) {
  const T      = (jd - 2451545.0) / 36525;
  const GST    = (280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * T * T) % 360;
  const LST    = ((GST + lonDeg) % 360 + 360) % 360;
  const eps    = (23.4393 - 0.0000004 * (jd - 2451545)) * Math.PI / 180;
  const lstRad = LST * Math.PI / 180;
  const latRad = latDeg * Math.PI / 180;
  const y      = -Math.cos(lstRad);
  const x      = Math.sin(lstRad) * Math.cos(eps) + Math.tan(latRad) * Math.sin(eps);
  return ((Math.atan2(y, x) * 180 / Math.PI) % 360 + 360) % 360;
}

function getWholeSignHouses(ascLon) {
  const ascSign = Math.floor(((ascLon % 360) + 360) % 360 / 30);
  return Array.from({ length: 12 }, function(_, i) {
    const lon = ((ascSign + i) * 30) % 360;
    return { house: i + 1, longitude: lon, ...lonToSign(lon) };
  });
}

// ── Routes ───────────────────────────────────────────────────

app.post("/chart", async function(req, res) {
  try {
    const { date, time, lat, lon, tz, houseSystem = "W" } = req.body;
    if (!date || lat == null || lon == null || !tz)
      return res.status(400).json({ error: "date, lat, lon and tz are required." });

    const localDT = DateTime.fromISO(date + "T" + (time || "12:00"), { zone: tz });
    if (!localDT.isValid)
      return res.status(400).json({ error: "Invalid date/time: " + localDT.invalidExplanation });

    const utcDT = localDT.toUTC();
    const jd    = toJD(utcDT);

    const sunLon  = getSunLon(jd);
    const moonLon = getMoonLon(jd);
    const rahuLon = getRahuLon(jd);
    const ketuLon = (rahuLon + 180) % 360;
    const ascLon  = time ? getAscendant(jd, lat, lon) : sunLon;

    const planets = {
      Sun:     { longitude: parseFloat(sunLon.toFixed(4)),  ...lonToSign(sunLon)  },
      Moon:    { longitude: parseFloat(moonLon.toFixed(4)), ...lonToSign(moonLon) },
      Mercury: { longitude: parseFloat(getPlanetLon(jd,"Mercury").toFixed(4)), ...lonToSign(getPlanetLon(jd,"Mercury")) },
      Venus:   { longitude: parseFloat(getPlanetLon(jd,"Venus").toFixed(4)),   ...lonToSign(getPlanetLon(jd,"Venus"))   },
      Mars:    { longitude: parseFloat(getPlanetLon(jd,"Mars").toFixed(4)),    ...lonToSign(getPlanetLon(jd,"Mars"))    },
      Jupiter: { longitude: parseFloat(getPlanetLon(jd,"Jupiter").toFixed(4)), ...lonToSign(getPlanetLon(jd,"Jupiter")) },
      Saturn:  { longitude: parseFloat(getPlanetLon(jd,"Saturn").toFixed(4)),  ...lonToSign(getPlanetLon(jd,"Saturn"))  },
      Uranus:  { longitude: parseFloat(getPlanetLon(jd,"Uranus").toFixed(4)),  ...lonToSign(getPlanetLon(jd,"Uranus"))  },
      Neptune: { longitude: parseFloat(getPlanetLon(jd,"Neptune").toFixed(4)), ...lonToSign(getPlanetLon(jd,"Neptune")) },
      Pluto:   { longitude: parseFloat(getPlanetLon(jd,"Pluto").toFixed(4)),   ...lonToSign(getPlanetLon(jd,"Pluto"))   },
      Rahu:    { longitude: parseFloat(rahuLon.toFixed(4)), ...lonToSign(rahuLon) },
      Ketu:    { longitude: parseFloat(ketuLon.toFixed(4)), ...lonToSign(ketuLon) },
    };

    const mcLon  = (ascLon + 270) % 360;
    const houses = getWholeSignHouses(ascLon);

    res.json({
      meta: { utc: utcDT.toISO(), julianDay: parseFloat(jd.toFixed(6)), lat, lon, tz, houseSystem: "Whole Sign", engine: "VSOP87 JS" },
      planets,
      ascendant: { longitude: parseFloat(ascLon.toFixed(4)), ...lonToSign(ascLon) },
      mc:        { longitude: parseFloat(mcLon.toFixed(4)),  ...lonToSign(mcLon)  },
      houses,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/timezone", async function(req, res) {
  try {
    const { lat, lon } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: "lat and lon required" });
    const fetch = (await import("node-fetch")).default;
    const data  = await (await fetch(
      "https://api.open-meteo.com/v1/forecast?latitude=" + lat +
      "&longitude=" + lon + "&timezone=auto&forecast_days=1&hourly=temperature_2m"
    )).json();
    res.json({ timezone: data.timezone, utcOffset: data.utc_offset_seconds / 3600 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/health", function(_, res) {
  res.json({ status: "ok", engine: "VSOP87 JS", node: process.version });
});

app.listen(PORT, function() {
  console.log("Astrology API running on port " + PORT);
});
