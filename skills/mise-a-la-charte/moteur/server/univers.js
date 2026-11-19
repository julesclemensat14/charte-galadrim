const fs = require("fs");
const path = require("path");

const UNIVERS = {
	noir: { nom: "noir", fond: "262524", pastel: "FFEAC7", visuels: ["corail-rose", "lilas-corail", "rouge-corail"] },
	vert: { nom: "vert", fond: "113511", pastel: "DBFFC7", visuels: ["coquelicots", "marguerites", "turquoise-vert"] },
	bleu: { nom: "bleu", fond: "111335", pastel: "C7F6FF", visuels: ["vague-bleue", "rose-bleu"] },
	violet: { nom: "violet", fond: "2C1135", pastel: "D8C7FF", visuels: ["lilas-corail", "fleurs-roses"] },
	jaune: { nom: "jaune", fond: "352C11", pastel: "FFFFC7", visuels: ["orange-ardoise", "sable-olive", "orange"] },
	rouge: { nom: "rouge", fond: "351111", pastel: "FFC7C7", visuels: ["rouge-corail", "coquelicots", "orange"] },
	cyan: { nom: "cyan", fond: "113533", pastel: "C7F6FF", visuels: ["turquoise-vert", "vague-bleue"] },
};

const DEFAUT = "noir";

const fichier = (dir) => path.join(dir, "univers.json");

const parNom = (nom) => (Object.hasOwn(UNIVERS, nom) ? UNIVERS[nom] : UNIVERS[DEFAUT]);

function lire(dir) {
	try {
		return parNom(JSON.parse(fs.readFileSync(fichier(dir), "utf8")).nom);
	} catch {
		return UNIVERS[DEFAUT];
	}
}

const existe = (dir) => fs.existsSync(fichier(dir));

function ecrire(dir, nom, raison = "") {
	const univers = parNom(nom);
	fs.writeFileSync(fichier(dir), JSON.stringify({ nom: univers.nom, raison }, null, 2));
	return univers;
}

const dejaRedige = (dir) =>
	fs.readdirSync(dir).some((f) => /^memoire.*\.md$/.test(f) || /^redige__.*\.md$/.test(f) || f === "moyens.pdf");

function image(u, quoi) {
	const nom = quoi === "couverture" ? "couverture.png" : `page-${(quoi % u.visuels.length) + 1}.png`;
	const chemin = path.join(__dirname, "../templates/univers", u.nom, nom);
	return fs.existsSync(chemin) ? chemin : null;
}

module.exports = { UNIVERS, DEFAUT, lire, existe, ecrire, dejaRedige, image };
