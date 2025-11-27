import React, { useEffect, useState } from "react";
import axios from "axios";
import Papa from "papaparse";
import "./App.css";

/** -------------------- CONFIG -------------------- */
const LIST_FIELDS = {
  credit: ["Eligible Credit Cards", "Eligible Cards"],
  debit: ["Eligible Debit Cards", "Applicable Debit Cards"],
  title: ["Offer Title", "Title", "Offer", "offer"],
  image: ["Image", "Credit Card Image", "Offer Image", "image", "Image URL"],
  link: ["Link", "Offer Link", "link", "URL"],
  desc: ["Description", "Details", "Offer Description", "description"],
};

const MAX_SUGGESTIONS = 50;

/** Sites that should display the red per-card “Applicable only on {variant} variant” note */
const VARIANT_NOTE_SITES = new Set([
  "Myntra",
  "Ajio",
  "Tata CLiQ",
  "Nykaa Fashion",
]);

/** -------------------- IMAGE FALLBACKS (CLOTHES) -------------------- */
const FALLBACK_IMAGE_BY_SITE = {
  myntra:
    "https://assets.myntassets.com/assets/images/2020/6/5/6b25e0b3-9f2d-4f5a-bb59-9968437bf3e11591347451735-myntra-logo.png",
  ajio: "https://assets.ajio.com/static/img/Ajio-Logo.svg",
  "tata cliq":
    "https://assets.tatacliq.com/medias/sys_master/images/13965856235550.png",
  "nykaa fashion":
    "https://images-static.nykaa.com/media/wysiwyg/2021/nykaa_fashion_logo.png",
};

function isUsableImage(val) {
  if (!val) return false;
  const s = String(val).trim();
  if (!s) return false;
  if (/^(na|n\/a|null|undefined|-|image unavailable)$/i.test(s)) return false;
  return true;
}

/** Decide which image to show + whether it's a fallback (logo) */
function resolveImage(siteKey, candidate) {
  const key = String(siteKey || "").toLowerCase();
  const fallback = FALLBACK_IMAGE_BY_SITE[key];
  const usingFallback = !isUsableImage(candidate) && !!fallback;
  return {
    src: usingFallback ? fallback : candidate,
    usingFallback,
  };
}

/** If the image fails, switch to fallback and mark as fallback for CSS */
function handleImgError(e, siteKey) {
  const key = String(siteKey || "").toLowerCase();
  const fallback = FALLBACK_IMAGE_BY_SITE[key];
  const el = e.currentTarget;
  if (fallback && el.src !== fallback) {
    el.src = fallback;
    el.classList.add("is-fallback");
  } else {
    el.style.display = "none"; // hide if even fallback fails
  }
}

/** -------------------- HELPERS -------------------- */
const toNorm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function firstField(obj, keys) {
  for (const k of keys) {
    if (
      obj &&
      Object.prototype.hasOwnProperty.call(obj, k) &&
      obj[k] !== undefined &&
      obj[k] !== null &&
      String(obj[k]).trim() !== ""
    ) {
      return obj[k];
    }
  }
  return undefined;
}

/** case-insensitive find for keys that CONTAIN a substring */
function firstFieldByContains(obj, substr) {
  if (!obj) return undefined;
  const target = String(substr).toLowerCase();
  for (const k of Object.keys(obj)) {
    if (String(k).toLowerCase().includes(target)) {
      const v = obj[k];
      if (v !== undefined && v !== null && String(v).trim() !== "") return v;
    }
  }
  return undefined;
}

/** split across many separators */
function splitList(val) {
  if (!val) return [];
  return String(val)
    .split(/,|\/|;|\||\n|\r|\t|\band\b|\bAND\b|•/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Strip trailing parentheses: "HDFC Regalia (Visa Signature)" -> "HDFC Regalia" */
function getBase(name) {
  if (!name) return "";
  return String(name).replace(/\s*\([^)]*\)\s*$/, "").trim();
}

/** Variant if present at end-in-parens: "… (Visa Signature)" -> "Visa Signature" */
function getVariant(name) {
  if (!name) return "";
  const m = String(name).match(/\(([^)]+)\)\s*$/);
  return m ? m[1].trim() : "";
}

/** Canonicalize some common brand spellings */
function brandCanonicalize(text) {
  let s = String(text || "");
  s = s.replace(/\bMakemytrip\b/gi, "MakeMyTrip");
  s = s.replace(/\bIcici\b/gi, "ICICI");
  s = s.replace(/\bHdfc\b/gi, "HDFC");
  s = s.replace(/\bSbi\b/gi, "SBI");
  s = s.replace(/\bIdfc\b/gi, "IDFC");
  s = s.replace(/\bPnb\b/gi, "PNB");
  s = s.replace(/\bRbl\b/gi, "RBL");
  s = s.replace(/\bYes\b/gi, "YES");
  return s;
}

/** Levenshtein distance */
function lev(a, b) {
  a = toNorm(a);
  b = toNorm(b);
  const n = a.length,
    m = b.length;
  if (!n) return m;
  if (!m) return n;
  const d = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost
      );
    }
  }
  return d[n][m];
}

function scoreCandidate(q, cand) {
  const qs = toNorm(q);
  const cs = toNorm(cand);
  if (!qs) return 0;
  if (cs.includes(qs)) return 100;

  const qWords = qs.split(" ").filter(Boolean);
  const cWords = cs.split(" ").filter(Boolean);

  const matchingWords = qWords.filter((qw) =>
    cWords.some((cw) => cw.includes(qw))
  ).length;
  const sim = 1 - lev(qs, cs) / Math.max(qs.length, cs.length);
  return (matchingWords / Math.max(1, qWords.length)) * 0.7 + sim * 0.3;
}

/** Dropdown entry builder */
function makeEntry(raw, type) {
  const base = brandCanonicalize(getBase(raw));
  return { type, display: base, baseNorm: toNorm(base) };
}

function normalizeUrl(u) {
  if (!u) return "";
  let s = String(u).trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
  if (s.endsWith("/")) s = s.slice(0, -1);
  return s;
}
function normalizeText(s) {
  return toNorm(s || "");
}
function offerKey(offer) {
  const imgGuess =
    firstField(offer, LIST_FIELDS.image) || firstFieldByContains(offer, "image");
  const image = normalizeUrl(imgGuess || "");
  const title = normalizeText(
    firstField(offer, LIST_FIELDS.title) || offer.Website || ""
  );
  const desc = normalizeText(firstField(offer, LIST_FIELDS.desc) || "");
  const link = normalizeUrl(firstField(offer, LIST_FIELDS.link) || "");
  return `${title}||${desc}||${image}||${link}`;
}

function dedupWrappers(arr, seen) {
  const out = [];
  for (const w of arr || []) {
    const k = offerKey(w.offer);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(w);
  }
  return out;
}

/** 🔹 NEW: does the query contain a word similar to "select"? (handles "selct", "selet", etc.) */
function hasSelectLikeWord(text) {
  const qs = toNorm(text);
  if (!qs) return false;
  const words = qs.split(" ").filter(Boolean);
  for (const w of words) {
    if (w === "select") return true;
    if (lev(w, "select") <= 2) return true;
  }
  return false;
}

/** Disclaimer */
const Disclaimer = () => (
  <section className="disclaimer">
    <h3>Disclaimer</h3>
    <p>
      All offers, coupons, and discounts listed on our platform are provided for
      informational purposes only. We do not guarantee the accuracy,
      availability, or validity of any offer. Users are advised to verify the
      terms and conditions with the respective merchants before making any
      purchase. We are not responsible for any discrepancies, expired offers, or
      losses arising from the use of these coupons.
    </p>
  </section>
);

/** -------------------- COMPONENT (CLOTHES) -------------------- */
const ClothesOffers = () => {
  const [creditEntries, setCreditEntries] = useState([]);
  const [debitEntries, setDebitEntries] = useState([]);

  const [marqueeCC, setMarqueeCC] = useState([]);
  const [marqueeDC, setMarqueeDC] = useState([]);

  const [filteredCards, setFilteredCards] = useState([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null); // {type, display, baseNorm}
  const [noMatches, setNoMatches] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  const [myntraOffers, setMyntraOffers] = useState([]);
  const [ajioOffers, setAjioOffers] = useState([]);
  const [tataCliqOffers, setTataCliqOffers] = useState([]);
  const [nykaaFashionOffers, setNykaaFashionOffers] = useState([]);

  /** Responsive */
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  /** Load allCards.csv for dropdown list */
  useEffect(() => {
    (async () => {
      try {
        const res = await axios.get(`/allCards.csv`);
        const parsed = Papa.parse(res.data, { header: true });
        const rows = parsed.data || [];

        const creditMap = new Map();
        const debitMap = new Map();

        for (const row of rows) {
          const ccList = splitList(firstField(row, LIST_FIELDS.credit));
          for (const raw of ccList) {
            const base = brandCanonicalize(getBase(raw));
            const baseNorm = toNorm(base);
            if (baseNorm) creditMap.set(baseNorm, creditMap.get(baseNorm) || base);
          }
          const dcList = splitList(firstField(row, LIST_FIELDS.debit));
          for (const raw of dcList) {
            const base = brandCanonicalize(getBase(raw));
            const baseNorm = toNorm(base);
            if (baseNorm) debitMap.set(baseNorm, debitMap.get(baseNorm) || base);
          }
        }

        const credit = Array.from(creditMap.values())
          .sort((a, b) => a.localeCompare(b))
          .map((d) => makeEntry(d, "credit"));
        const debit = Array.from(debitMap.values())
          .sort((a, b) => a.localeCompare(b))
          .map((d) => makeEntry(d, "debit"));

        setCreditEntries(credit);
        setDebitEntries(debit);
      } catch (e) {
        console.debug("[ClothesOffers] allCards.csv load error:", e);
        setNoMatches(true);
        setSelected(null);
      }
    })();
  }, []);

  /** Load CLOTHES offer CSVs */
  useEffect(() => {
    (async () => {
      try {
        const specs = [
          { name: "Myntra.csv", setter: setMyntraOffers },
          { name: "Ajio.csv", setter: setAjioOffers },
          { name: "tata_cliq.csv", setter: setTataCliqOffers },
          { name: "nykaa_fashion.csv", setter: setNykaaFashionOffers },
        ];

        await Promise.all(
          specs.map(async (f) => {
            const res = await axios.get(`/${encodeURIComponent(f.name)}`);
            const parsed = Papa.parse(res.data, {
              header: true,
              skipEmptyLines: true,
            });
            const rows = parsed.data || [];
            f.setter(rows);
          })
        );
      } catch (e) {
        console.debug("[ClothesOffers] Offer CSV load error:", e);
      }
    })();
  }, []);

  /** Build marquee CC/DC from clothes offers */
  useEffect(() => {
    const ccMap = new Map();
    const dcMap = new Map();

    const harvestRows = (rows) => {
      for (const o of rows || []) {
        const cc = splitList(firstField(o, LIST_FIELDS.credit));
        const dc = splitList(firstField(o, LIST_FIELDS.debit));

        for (const raw of cc) {
          if (toNorm(raw) === "all cc") continue;
          const base = brandCanonicalize(getBase(raw));
          const baseNorm = toNorm(base);
          if (baseNorm) ccMap.set(baseNorm, ccMap.get(baseNorm) || base);
        }
        for (const raw of dc) {
          if (toNorm(raw) === "all dc") continue;
          const base = brandCanonicalize(getBase(raw));
          const baseNorm = toNorm(base);
          if (baseNorm) dcMap.set(baseNorm, dcMap.get(baseNorm) || base);
        }
      }
    };

    harvestRows(myntraOffers);
    harvestRows(ajioOffers);
    harvestRows(tataCliqOffers);
    harvestRows(nykaaFashionOffers);

    setMarqueeCC(
      Array.from(ccMap.values()).sort((a, b) => a.localeCompare(b))
    );
    setMarqueeDC(
      Array.from(dcMap.values()).sort((a, b) => a.localeCompare(b))
    );
  }, [myntraOffers, ajioOffers, tataCliqOffers, nykaaFashionOffers]);

  /** Search box */
  const onChangeQuery = (e) => {
    const val = e.target.value;
    setQuery(val);

    const trimmed = val.trim();
    if (!trimmed) {
      setFilteredCards([]);
      setSelected(null);
      setNoMatches(false);
      return;
    }

    const qLower = trimmed.toLowerCase();
    const queryHasSelectLike = hasSelectLikeWord(trimmed);

    const scored = (arr) =>
      arr
        .map((it) => {
          const s = scoreCandidate(trimmed, it.display);
          const labelNorm = toNorm(it.display);
          const inc = labelNorm.includes(qLower);

          const labelWords = labelNorm.split(" ").filter(Boolean);
          const labelHasSelectWord = labelWords.some(
            (w) => w === "select" || lev(w, "select") <= 1
          );

          const passesFuzzySelect =
            queryHasSelectLike && labelHasSelectWord;

          return { it, s, inc, passesFuzzySelect };
        })
        .filter(({ s, inc, passesFuzzySelect }) => inc || s > 0.3 || passesFuzzySelect)
        .sort((a, b) => b.s - a.s || a.it.display.localeCompare(b.it.display))
        .slice(0, MAX_SUGGESTIONS)
        .map(({ it }) => it);

    let cc = scored(creditEntries);
    let dc = scored(debitEntries);

    if (!cc.length && !dc.length) {
      setNoMatches(true);
      setSelected(null);
      setFilteredCards([]);
      return;
    }

    setNoMatches(false);

    if (queryHasSelectLike) {
      const bumpSelectCards = (arr) => {
        const selectOnTop = [];
        const rest = [];
        arr.forEach((item) => {
          const norm = toNorm(item.display);
          const words = norm.split(" ").filter(Boolean);
          const hasSelectWord = words.some(
            (w) => w === "select" || lev(w, "select") <= 1
          );
          if (hasSelectWord) selectOnTop.push(item);
          else rest.push(item);
        });
        return [...selectOnTop, ...rest];
      };
      cc = bumpSelectCards(cc);
      dc = bumpSelectCards(dc);
    }

    setFilteredCards([
      ...(cc.length ? [{ type: "heading", label: "Credit Cards" }] : []),
      ...cc,
      ...(dc.length ? [{ type: "heading", label: "Debit Cards" }] : []),
      ...dc,
    ]);
  };

  const onPick = (entry) => {
    setSelected(entry);
    setQuery(entry.display);
    setFilteredCards([]);
    setNoMatches(false);
  };

  const handleChipClick = (name, type) => {
    const display = brandCanonicalize(getBase(name));
    const baseNorm = toNorm(display);
    setQuery(display);
    setSelected({ type, display, baseNorm });
    setFilteredCards([]);
    setNoMatches(false);
  };

  /** Build matches per site (credit/debit) */
  function matchesFor(offers, type, site) {
    if (!selected) return [];
    const out = [];

    for (const o of offers || []) {
      let list = [];

      if (type === "debit") {
        const dcExplicit =
          firstField(o, LIST_FIELDS.debit) ||
          firstFieldByContains(o, "eligible debit") ||
          firstFieldByContains(o, "debit card");
        list = splitList(dcExplicit);
      } else {
        const ccExplicit =
          firstField(o, LIST_FIELDS.credit) ||
          firstFieldByContains(o, "eligible credit") ||
          firstFieldByContains(o, "credit card") ||
          firstFieldByContains(o, "eligible cards");
        list = splitList(ccExplicit);
      }

      // handle ALL CC / ALL DC
      if (list.some((v) => toNorm(v) === "all cc") && selected.type === "credit") {
        out.push({ offer: o, site, variantText: "" });
        continue;
      }
      if (list.some((v) => toNorm(v) === "all dc") && selected.type === "debit") {
        out.push({ offer: o, site, variantText: "" });
        continue;
      }

      let matched = false;
      let matchedVariant = "";

      for (const raw of list) {
        const base = brandCanonicalize(getBase(raw));
        if (toNorm(base) === selected.baseNorm) {
          matched = true;
          const v = getVariant(raw);
          if (v) matchedVariant = v;
          break;
        }
      }

      if (matched) {
        out.push({ offer: o, site, variantText: matchedVariant });
      }
    }

    return out;
  }

  const wMyntra = matchesFor(
    myntraOffers,
    selected?.type === "debit" ? "debit" : "credit",
    "Myntra"
  );
  const wAjio = matchesFor(
    ajioOffers,
    selected?.type === "debit" ? "debit" : "credit",
    "Ajio"
  );
  const wTataCliq = matchesFor(
    tataCliqOffers,
    selected?.type === "debit" ? "debit" : "credit",
    "Tata CLiQ"
  );
  const wNykaa = matchesFor(
    nykaaFashionOffers,
    selected?.type === "debit" ? "debit" : "credit",
    "Nykaa Fashion"
  );

  const seen = new Set();
  const dMyntra = dedupWrappers(wMyntra, seen);
  const dAjio = dedupWrappers(wAjio, seen);
  const dTataCliq = dedupWrappers(wTataCliq, seen);
  const dNykaa = dedupWrappers(wNykaa, seen);

  const hasAny = Boolean(
    dMyntra.length || dAjio.length || dTataCliq.length || dNykaa.length
  );

  /** Offer card UI – scrollable description, button only if link exists */
  const OfferCard = ({ wrapper }) => {
    const o = wrapper.offer;
    const siteName = wrapper.site;
    const siteKey = String(siteName || "").toLowerCase();

    const showVariantNote =
      VARIANT_NOTE_SITES.has(wrapper.site) &&
      wrapper.variantText &&
      wrapper.variantText.trim().length > 0;

    let image =
      firstField(o, LIST_FIELDS.image) || firstFieldByContains(o, "image");
    let title =
      firstField(o, LIST_FIELDS.title) || o.Website || "Offer";
    let desc = firstField(o, LIST_FIELDS.desc) || "";
    let link = firstField(o, LIST_FIELDS.link);

    const { src: imgSrc, usingFallback } = resolveImage(siteKey, image);

    const descBoxStyle = {
      maxHeight: 140,
      overflowY: "auto",
      paddingRight: 8,
      border: "1px solid #eee",
      borderRadius: 6,
      padding: "10px 12px",
      background: "#fafafa",
      lineHeight: 1.5,
      whiteSpace: "pre-wrap",
    };

    return (
      <div className="offer-card">
        {imgSrc && (
          <img
            className={`offer-img ${usingFallback ? "is-fallback" : ""}`}
            src={imgSrc}
            alt="Offer"
            onError={(e) => handleImgError(e, siteKey)}
          />
        )}

        <div className="offer-info">
          {title && (
            <div
              className="offer-title"
              style={{ fontWeight: 700, marginBottom: 8, fontSize: 16 }}
            >
              {title}
            </div>
          )}

          {desc && (
            <div className="offer-desc" style={descBoxStyle}>
              {desc}
            </div>
          )}

          {showVariantNote && (
            <p
              className="network-note"
              style={{ color: "#b00020", marginTop: 8 }}
            >
              <strong>Note:</strong> This benefit is applicable only on{" "}
              <em>{wrapper.variantText}</em> variant
            </p>
          )}

          {/* 🔹 Only show button if link is present */}
          {link && String(link).trim() && (
            <button
              className="btn"
              onClick={() => window.open(link, "_blank")}
            >
              View Offer
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="App" style={{ fontFamily: "'Libre Baskerville', serif" }}>
      {(marqueeCC.length > 0 || marqueeDC.length > 0) && (
        <div
          style={{
            maxWidth: 1200,
            margin: "14px auto 0",
            padding: "14px 16px",
            background: "#F7F9FC",
            border: "1px solid #E8EDF3",
            borderRadius: 10,
            boxShadow: "0 6px 18px rgba(15,23,42,.06)",
          }}
        >
          <div
            style={{
              fontWeight: 700,
              fontSize: 16,
              color: "#1F2D45",
              marginBottom: 10,
              display: "flex",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <span>Credit And Debit Cards Which Have Offers</span>
          </div>

          {marqueeCC.length > 0 && (
            <marquee
              direction="left"
              scrollamount="4"
              style={{ marginBottom: 8, whiteSpace: "nowrap" }}
            >
              <strong style={{ marginRight: 10, color: "#1F2D45" }}>
                Credit Cards:
              </strong>
              {marqueeCC.map((name, idx) => (
                <span
                  key={`cc-chip-${idx}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleChipClick(name, "credit")}
                  onKeyDown={(e) =>
                    e.key === "Enter" ? handleChipClick(name, "credit") : null
                  }
                  style={{
                    display: "inline-block",
                    padding: "6px 10px",
                    border: "1px solid #E0E6EE",
                    borderRadius: 9999,
                    marginRight: 8,
                    background: "#fff",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                    cursor: "pointer",
                    fontSize: 14,
                    lineHeight: 1.2,
                    userSelect: "none",
                  }}
                  onMouseOver={(e) =>
                    (e.currentTarget.style.background = "#F0F5FF")
                  }
                  onMouseOut={(e) =>
                    (e.currentTarget.style.background = "#fff")
                  }
                  title="Click to select this card"
                >
                  {name}
                </span>
              ))}
            </marquee>
          )}

          {marqueeDC.length > 0 && (
            <marquee
              direction="left"
              scrollamount="4"
              style={{ whiteSpace: "nowrap" }}
            >
              <strong style={{ marginRight: 10, color: "#1F2D45" }}>
                Debit Cards:
              </strong>
              {marqueeDC.map((name, idx) => (
                <span
                  key={`dc-chip-${idx}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleChipClick(name, "debit")}
                  onKeyDown={(e) =>
                    e.key === "Enter" ? handleChipClick(name, "debit") : null
                  }
                  style={{
                    display: "inline-block",
                    padding: "6px 10px",
                    border: "1px solid #E0E6EE",
                    borderRadius: 9999,
                    marginRight: 8,
                    background: "#fff",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                    cursor: "pointer",
                    fontSize: 14,
                    lineHeight: 1.2,
                    userSelect: "none",
                  }}
                  onMouseOver={(e) =>
                    (e.currentTarget.style.background = "#F0F5FF")
                  }
                  onMouseOut={(e) =>
                    (e.currentTarget.style.background = "#fff")
                  }
                  title="Click to select this card"
                >
                  {name}
                </span>
              ))}
            </marquee>
          )}
        </div>
      )}

      {/* Search / dropdown */}
      <div
        className="dropdown"
        style={{ position: "relative", width: "600px", margin: "20px auto" }}
      >
        <input
          type="text"
          value={query}
          onChange={onChangeQuery}
          placeholder="Type a Credit or Debit Card to check the clothes offers...."
          className="dropdown-input"
          style={{
            width: "100%",
            padding: "12px",
            fontSize: "16px",
            border: `1px solid ${noMatches ? "#d32f2f" : "#ccc"}`,
            borderRadius: "6px",
          }}
        />
        {query.trim() && !!filteredCards.length && (
          <ul
            className="dropdown-list"
            style={{
              listStyle: "none",
              padding: "10px",
              margin: 0,
              width: "100%",
              maxHeight: "260px",
              overflowY: "auto",
              border: "1px solid #ccc",
              borderRadius: "6px",
              backgroundColor: "#fff",
              position: "absolute",
              zIndex: 1000,
            }}
          >
            {filteredCards.map((item, idx) =>
              item.type === "heading" ? (
                <li
                  key={`h-${idx}`}
                  style={{
                    padding: "8px 10px",
                    fontWeight: 700,
                    background: "#fafafa",
                  }}
                >
                  {item.label}
                </li>
              ) : (
                <li
                  key={`i-${idx}-${item.display}`}
                  onClick={() => onPick(item)}
                  style={{
                    padding: "10px",
                    cursor: "pointer",
                    borderBottom: "1px solid #f2f2f2",
                  }}
                  onMouseOver={(e) =>
                    (e.currentTarget.style.background = "#f7f9ff")
                  }
                  onMouseOut={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  {item.display}
                </li>
              )
            )}
          </ul>
        )}
      </div>

      {/* Offers by section */}
      {selected && hasAny && !noMatches && (
        <div
          className="offers-section"
          style={{ maxWidth: 1200, margin: "0 auto", padding: 20 }}
        >
          {!!dMyntra.length && (
            <div className="offer-group">
              <h2 style={{ textAlign: "center" }}>Offers on Myntra</h2>
              <div className="offer-grid">
                {dMyntra.map((w, i) => (
                  <OfferCard key={`myn-${i}`} wrapper={w} />
                ))}
              </div>
            </div>
          )}

          {!!dAjio.length && (
            <div className="offer-group">
              <h2 style={{ textAlign: "center" }}>Offers on Ajio</h2>
              <div className="offer-grid">
                {dAjio.map((w, i) => (
                  <OfferCard key={`ajio-${i}`} wrapper={w} />
                ))}
              </div>
            </div>
          )}

          {!!dTataCliq.length && (
            <div className="offer-group">
              <h2 style={{ textAlign: "center" }}>Offers on Tata CLiQ</h2>
              <div className="offer-grid">
                {dTataCliq.map((w, i) => (
                  <OfferCard key={`tata-${i}`} wrapper={w} />
                ))}
              </div>
            </div>
          )}

          {!!dNykaa.length && (
            <div className="offer-group">
              <h2 style={{ textAlign: "center" }}>Offers on Nykaa Fashion</h2>
              <div className="offer-grid">
                {dNykaa.map((w, i) => (
                  <OfferCard key={`nykaa-${i}`} wrapper={w} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {selected && !hasAny && !noMatches && (
        <p style={{ color: "#d32f2f", textAlign: "center", marginTop: 10 }}>
          No offer available for this card on clothes websites
        </p>
      )}

      {/* Floating scroll button */}
      {selected && hasAny && !noMatches && (
        <button
          onClick={() =>
            window.scrollBy({
              top: window.innerHeight,
              behavior: "smooth",
            })
          }
          style={{
            position: "fixed",
            right: 20,
            bottom: isMobile ? 250 : 280,
            padding: isMobile ? "12px 15px" : "10px 20px",
            backgroundColor: "#1e7145",
            color: "white",
            border: "none",
            borderRadius: isMobile ? "50%" : 8,
            cursor: "pointer",
            fontSize: 18,
            zIndex: 1000,
            boxShadow: "0 2px 5px rgba(0,0,0,0.2)",
            width: isMobile ? 50 : 140,
            height: 50,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          {isMobile ? "↓" : "Scroll Down"}
        </button>
      )}

      <Disclaimer />
    </div>
  );
};

export default ClothesOffers;
