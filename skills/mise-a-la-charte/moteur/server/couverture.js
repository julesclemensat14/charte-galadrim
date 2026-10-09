const fs = require("fs");
const path = require("path");


const FICHIER = "couverture.json";

const lignesContacts = (personnes, adresse = require("./identite").parse().adresseBureaux) => {
	const gens = (Array.isArray(personnes) ? personnes : []).filter((p) => p && (p.nom || p.email));
	const joint = (champ) =>
		gens
			.map((p) => String(p[champ] || "").trim())
			.filter(Boolean)
			.join(" / ");
	return [
		{ label: "Société", value: "Galadrim" },
		{ label: "Interlocuteurs", value: joint("nom") },
		{ label: "Adresse e-mail", value: joint("email") },
		{ label: "Téléphone", value: "" },
		{ label: "Adresse", value: adresse },
	];
};

const LIGNES_DEFAUT = lignesContacts([]);

function personnesDeLaPrise(id) {
	try {
		const prise = require("./prises").get(id);
		const utilisateur = require("./forest/utilisateur");
		return (prise && Array.isArray(prise.equipe) ? prise.equipe : []).map((u) => ({
			nom: utilisateur.nomDe(u),
			email: utilisateur.emailDe(u),
		}));
	} catch (err) {
		console.error(`   ⚠️  interlocuteurs du dossier illisibles (${err && err.message}) — aucun contact.`);
		return [];
	}
}

const lignesDeLaPrise = (id) =>
	lignesContacts(personnesDeLaPrise(id), require("./identite").duDossier(id).adresseBureaux);

const MAX_LIGNES = 12;
const MAX_TEXTE = 200;

const fichier = (dir) => path.join(dir, FICHIER);

function lireTout(dir) {
	try {
		const map = JSON.parse(fs.readFileSync(fichier(dir), "utf8"));
		return map && typeof map === "object" ? map : {};
	} catch {
		return {};
	}
}

function normaliser(bloc) {
	const b = bloc && typeof bloc === "object" ? bloc : {};
	const coupe = (v) =>
		String(v == null ? "" : v)
			.trim()
			.slice(0, MAX_TEXTE);
	const lignes = (Array.isArray(b.lignes) ? b.lignes : [])
		.map((l) => ({ label: coupe(l && l.label), value: coupe(l && l.value) }))
		.filter((l) => l.label || l.value)
		.slice(0, MAX_LIGNES);
	return { titre: coupe(b.titre), lignes };
}

function lire(dir, docKey) {
	const enregistre = lireTout(dir)[docKey];
	if (enregistre && Array.isArray(enregistre.lignes) && enregistre.lignes.length) return normaliser(enregistre);
	return { titre: (enregistre && String(enregistre.titre || "")) || "", lignes: LIGNES_DEFAUT.map((l) => ({ ...l })) };
}

function ecrire(dir, docKey, bloc) {
	const map = lireTout(dir);
	map[docKey] = normaliser(bloc);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(fichier(dir), JSON.stringify(map, null, 2));
	return map[docKey];
}

function initialiser(dir, docKey, defauts) {
	const map = lireTout(dir);
	if (map[docKey]) return lire(dir, docKey);
	return ecrire(dir, docKey, { ...(defauts || {}), lignes: (defauts && defauts.lignes) || LIGNES_DEFAUT });
}

module.exports = {
	LIGNES_DEFAUT,
	lignesContacts,
	personnesDeLaPrise,
	lignesDeLaPrise,
	normaliser,
	lire,
	ecrire,
	initialiser,
};
