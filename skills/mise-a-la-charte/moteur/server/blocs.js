
const visuels = require("./visuels");

const TYPES = ["intercalaire", "citation", "chiffres"];

const MARQUEUR = /^\s*\[\[([^\]\n]*)\]\]\s*/;
const INTERCALAIRES_PAR_PARTIE = 1;
const CITATIONS_MAX = 2;
const LIGNES_CHIFFRES_MIN = 2;

function directive(texte) {
	const m = MARQUEUR.exec(String(texte || ""));
	const type = m && m[1].trim().toLowerCase();
	return TYPES.includes(type) ? { type, texte: String(texte).slice(m[0].length).trim() } : null;
}

const sansMarqueur = (texte) => String(texte || "").replace(MARQUEUR, "");

const sansMarqueurs = (md) =>
	String(md || "").replace(/^[ \t]*((?:[-*>][ \t]*|\d+\.[ \t]+)?)\[\[[^\]\n]*\]\][ \t]*/gm, "$1");

const POINTS_MAX = { intercalaire: 4, citation: 1 };
const POINT = /^\*\*([^*]{1,30}?)[.:]?\*\*\s+(\S.{0,159})$/;
function points(type, puces) {
	const lus = puces.map((p) => POINT.exec(String(p).trim()));
	return lus.length <= (POINTS_MAX[type] || 0) && lus.every(Boolean)
		? lus.map(([, repere, texte]) => ({ repere, texte }))
		: [];
}

const pagesPleinesPermises = (brief) => !((brief || {}).format || {}).limitePages;


const MULTIPLES = { million: 1e6, milliard: 1e9 };
function nombres(texte) {
	const t = String(texte || "").replace(/(\d)[   .](?=\d{3}(?!\d))/g, "$1");
	return [...t.matchAll(/(\d+(?:[.,]\d+)?)(?:\s*(million|milliard)s?(?![\p{L}-]))?/giu)].map(([, n, m]) => {
		const v = n.replace(",", ".");
		return m ? String(Math.round(Number(v) * MULTIPLES[m.toLowerCase()])) : v;
	});
}

const cellules = (ligne) => ligne.trim().replace(/^\|/, "").split("|");

function tableau(lignes, i, vus) {
	let debut = i + 1;
	while (debut < lignes.length && !lignes[debut].trim()) debut++;
	let fin = debut;
	while (fin < lignes.length && lignes[fin].trim().startsWith("|")) fin++;
	if (fin - debut < 2 || !/^\|?[\s:|-]+\|?$/.test(lignes[debut + 1].trim())) return null;
	const j = Math.max(0, visuels.colonneChiffre(cellules(lignes[debut])));
	const donnees = lignes.slice(debut + 2, fin).filter((l) => nombres(cellules(l)[j]).some((n) => vus.has(n)));
	return { debut, fin, entete: lignes.slice(debut, debut + 2), donnees };
}


function filtrer(md, { pagesPleines, sources }) {
	const lignes = String(md || "").split("\n");
	const vus = new Set(nombres(sources));
	const sortie = [];
	let precedent = "";
	let intercalaires = 0;
	let citations = 0;
	for (let i = 0; i < lignes.length; i++) {
		const ligne = lignes[i];
		const d = directive(ligne);
		if (d && d.type === "chiffres") {
			const t = tableau(lignes, i, vus);
			if (t && t.donnees.length >= LIGNES_CHIFFRES_MIN) {
				sortie.push(ligne, ...lignes.slice(i + 1, t.debut), ...t.entete, ...t.donnees);
				precedent = "texte";
			} else if (!t && d.texte) {
				sortie.push(d.texte);
				precedent = "texte";
			}
			if (t) i = t.fin - 1;
			continue;
		}
		if (d) {
			const garde =
				pagesPleines &&
				(d.type === "intercalaire"
					? precedent === "titre" && intercalaires < INTERCALAIRES_PAR_PARTIE
					: citations < CITATIONS_MAX && precedent !== "intercalaire" && precedent !== "citation");
			if (!garde) continue;
		}
		sortie.push(ligne);
		if (!ligne.trim()) continue;
		if (d) {
			precedent = d.type;
			if (d.type === "intercalaire") intercalaires++;
			else citations++;
		} else if (/^## /.test(ligne)) {
			precedent = "titre";
			intercalaires = 0;
		} else precedent = "texte";
	}
	return sortie.join("\n");
}


function consigne(brief) {
	const pagesPleines = pagesPleinesPermises(brief);
	return [
		"Tu disposes de blocs visuels. Chacun parle de CET acheteur : ses enjeux, ses chiffres, ses mots. Un bloc qui conviendrait à n'importe quel marché ne sert à rien, ne le pose pas.",
		...(pagesPleines
			? [
					"- `[[intercalaire]] Phrase d'ouverture` : sur une ligne seule, juste sous le titre `## ` d'une grande partie. Page pleine qui annonce l'enjeu de l'acheteur que la partie traite. Suivie de 2 à 4 points clés `- **Repère.** texte` (repère de 2 à 4 mots ou un chiffre, texte de 120 caractères au plus) : ce que l'acheteur trouve dans la partie, avec ses chiffres et ses mots.",
					"- `[[citation]] Phrase` : sur une ligne seule, entre deux paragraphes. Page pleine pour l'engagement qui compte le plus pour lui, jamais attribuée, jamais de guillemets. Suivie d'une seule puce `- **8 h.** délai garanti de remise en état` : la preuve, un fait vérifiable du mémoire (chiffre engagé, référence client, délai garanti).",
				]
			: []),
		"- `[[chiffres]]` suivi d'un tableau `| Chiffre | Ce qu'il mesure |` de 2 à 5 lignes, un nombre par ligne. Uniquement des chiffres lus dans la fiche acheteur ou le dossier, jamais estimés : ceux que tu ne retrouves pas dans ces sources sont retirés.",
		"Formes déjà reconnues, à écrire comme avant : les étapes `1. **Titre.** texte` (3 à 6), le tableau `Engagement | …` (2 à 4 lignes), le tableau `Aujourd'hui | Demain` pour l'avant et l'après, l'encadré `> ` pour l'engagement clé.",
		pagesPleines
			? "Dosage : au plus un intercalaire par grande partie, deux citations au plus dans tout le mémoire, jamais deux pages pleines d'affilée."
			: "Dosage : le règlement limite les pages, donc aucune page pleine : ni intercalaire ni citation.",
		"Un bloc s'ajoute au texte et ne le remplace pas : ne raccourcis jamais un développement pour lui faire de la place.",
	].join("\n");
}

module.exports = {
	TYPES,
	CITATIONS_MAX,
	directive,
	sansMarqueur,
	sansMarqueurs,
	points,
	pagesPleinesPermises,
	filtrer,
	consigne,
};
