
const frise = require("./frise");


const ETAPE = /^(\d{1,2})[.)]\s+\*\*([^*]{2,40}?)\s*[.:]?\*\*\s*[.:]?\s*(.*)$/;
const ETAPES_MIN = 3;
const ETAPES_MAX = 6;
const TEXTE_ETAPE_MAX = 420;

function etape(texte) {
	const m = ETAPE.exec(String(texte || "").trim());
	return m ? { n: Number(m[1]), titre: m[2].trim(), texte: m[3].trim() } : null;
}

function etapes(blocks, i) {
	const items = [];
	for (let k = i; k < blocks.length && blocks[k].t === "p"; k++) {
		const e = etape(blocks[k].text);
		if (!e || e.n !== items.length + 1) break;
		items.push(e);
	}
	if (items.length < ETAPES_MIN || items.length > ETAPES_MAX) return null;
	if (items.some((e) => e.texte.length > TEXTE_ETAPE_MAX)) return null;
	return items;
}

const PAR_RANGEE = 4;
const ETAPE_LONGUE = 260;
function rangees(items) {
	const max = items.some((e) => e.texte.length > ETAPE_LONGUE) ? 3 : PAR_RANGEE;
	const par = Math.ceil(items.length / Math.ceil(items.length / max));
	const out = [];
	for (let k = 0; k < items.length; k += par) out.push(items.slice(k, k + par));
	return out;
}


const sansGras = (t) =>
	String(t || "")
		.replace(/\*\*/g, "")
		.trim();

const COLONNE_CHIFFRE = /chiffre|d[ée]lai/i;
const TUILES_MAX = 5;

const FIN_UNITE = "(?![\\p{L}-])";
const UNITES = [
	[new RegExp(`^(?:heures?|h)${FIN_UNITE}`, "iu"), "h"],
	[new RegExp(`^(?:jours?|j)${FIN_UNITE}`, "iu"), "j"],
	[new RegExp(`^minutes?${FIN_UNITE}`, "iu"), "min"],
	[new RegExp(`^semaines?${FIN_UNITE}`, "iu"), "sem."],
	[new RegExp(`^mois${FIN_UNITE}`, "iu"), "mois"],
	[new RegExp(`^ans?${FIN_UNITE}`, "iu"), null],
	[new RegExp(`^(?:millions?|milliards?)${FIN_UNITE}`, "iu"), null],
	[
		new RegExp(
			`^(?:janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre)${FIN_UNITE}`,
			"iu",
		),
		null,
	],
	[new RegExp(`^ms${FIN_UNITE}`, "u"), "ms"],
	[new RegExp(`^(?:secondes?|s)${FIN_UNITE}`, "u"), "s"],
	[/^%/, "%"],
	[/^[Mk]?€/, null],
	[new RegExp(`^[KkMGT]o${FIN_UNITE}`, "u"), null],
];

function chiffre(cellule) {
	const c = sansGras(cellule);
	const m = /^([<>≤≥]\s*)?(\d+(?:[\s  ]\d{3})*(?:[,.]\d+)?(?:\s*(?:à|-|–)\s*\d+(?:[,.]\d+)?)?(?:er\b)?)\s*/.exec(c);
	if (!m) return null;
	let reste = c.slice(m[0].length);
	let unite = "";
	for (const [re, abr] of UNITES) {
		const u = re.exec(reste);
		if (!u) continue;
		unite = abr || u[0];
		reste = reste.slice(u[0].length);
		break;
	}
	if (/^\s*\//.test(reste)) return null;
	const nombre = `${(m[1] || "").replace(/\s+/g, " ")}${m[2].replace(/\s*(?:à|-|–)\s*/, "–")}`;
	return {
		valeur: unite ? `${nombre} ${unite}` : nombre,
		precision: reste.replace(/^[\s,;:.·]+/, "").trim(),
	};
}

const deuxColonnes = (rows, min, max) =>
	Array.isArray(rows) &&
	rows.length >= min + 1 &&
	rows.length <= max + 1 &&
	rows.every((r) => r.length === 2 && r.every((c) => String(c).trim()));

function colonneChiffre(entetes) {
	const cols = [0, 1].filter((j) => COLONNE_CHIFFRE.test(entetes[j] || ""));
	return cols.length === 1 ? cols[0] : -1;
}

const UNITE_ENTETE = /\(([^()]+)\)\s*$/;

function avecUnite(c, unite) {
	if (!unite || !/\d$/.test(c.valeur)) return c.valeur;
	const u = chiffre(`${c.valeur} ${unite}`);
	return u && !u.precision ? u.valeur : c.valeur;
}

function tuiles(rows) {
	if (!deuxColonnes(rows, 2, TUILES_MAX)) return null;
	const j = colonneChiffre(rows[0]);
	if (j < 0) return null;
	const unite = (UNITE_ENTETE.exec(sansGras(rows[0][j])) || [])[1];
	const out = [];
	for (const r of rows.slice(1)) {
		const c = chiffre(r[j]);
		if (!c) return null;
		out.push({ valeur: avecUnite(c, unite), libelle: sansGras(r[1 - j]), precision: c.precision });
	}
	return out;
}


function cartes(rows) {
	if (!deuxColonnes(rows, 2, 4)) return null;
	if (!/engagement/i.test(rows[0][0]) || COLONNE_CHIFFRE.test(rows[0][1])) return null;
	return rows.slice(1).map((r) => ({ titre: sansGras(r[0]), texte: r[1] }));
}


function avantApres(rows) {
	if (!deuxColonnes(rows, 2, 6)) return null;
	if (!/aujourd|avant|existant|actuel/i.test(rows[0][0]) || !/apr[eè]s|demain|cible|futur/i.test(rows[0][1]))
		return null;
	return { entetes: rows[0].map(sansGras), lignes: rows.slice(1) };
}


function jalons(rows) {
	const f = frise.lire(rows);
	if (!f) return null;
	const vus = new Set();
	const points = [];
	for (const t of f.taches) {
		const nom = sansGras(t.jalon);
		if (!nom || vus.has(nom.toLowerCase())) continue;
		vus.add(nom.toLowerCase());
		points.push({ k: t.a, nom, quand: f.colonnes[t.a] });
	}
	if (points.length < 2) return null;
	points.sort((a, b) => a.k - b.k);
	const n = f.colonnes.length;
	const couvert = Array.from({ length: n }, (_, k) =>
		f.taches.some((t) => !/continu/i.test(t.groupe) && k >= t.de && k <= t.a),
	);
	return { colonnes: f.colonnes, bandeaux: f.bandeaux, points, couvert };
}

function rangerJalons(points, n, largeur) {
	const lignes = [];
	for (const p of points) {
		const aDroite = p.k + largeur > n;
		const de = aDroite ? Math.max(0, p.k - largeur + 1) : p.k;
		const a = aDroite ? p.k : p.k + largeur - 1;
		let ligne = lignes.find((l) => l.every((x) => x.a < de || x.de > a));
		if (!ligne) lignes.push((ligne = []));
		ligne.push({ ...p, de, a, aDroite });
	}
	return lignes.map((l) => l.sort((x, y) => x.de - y.de));
}


const TITRE_COUP_D_OEIL = "Synthèse de notre réponse";
const COUP_D_OEIL = new RegExp(`en un coup d['’]\\s*(?:œ|oe)il|^(?:#+\\s*)?${TITRE_COUP_D_OEIL}\\s*$`, "i");
const DELAIS = /d[ée]lais?\s+(?:d['’]\s*ex[ée]cution|de\s+r[ée]alisation)/i;

module.exports = {
	etapes,
	rangees,
	chiffre,
	colonneChiffre,
	tuiles,
	cartes,
	avantApres,
	jalons,
	rangerJalons,
	COUP_D_OEIL,
	TITRE_COUP_D_OEIL,
	DELAIS,
};
