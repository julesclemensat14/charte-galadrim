
const EN_TETE = ["Tâche", "Groupe", "Début", "Fin", "Jalon"];

const normal = (t) =>
	String(t == null ? "" : t)
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[*_`]/g, "")
		.replace(/[^a-z0-9]+/gi, " ")
		.trim()
		.toLowerCase();

const arrondiDemi = (n) => {
	const v = Math.round((Number(n) || 0) * 2) / 2;
	return v === 0 && Number(n) > 0 ? 0.5 : v;
};
const fmt = (n) => String(n).replace(".", ",");

const OPTION = /\bPSE\b|suppl[ée]mentaires?\s+[ée]ventuelles?|\boptions?\b/i;

function lignes(arretes) {
	const out = [];
	const vues = new Set();
	for (const arrete of [].concat(arretes || []).filter(Boolean))
		for (const s of Array.isArray(arrete.sections) ? arrete.sections : []) {
			if (OPTION.test(s.nom || "")) continue;
			for (const l of Array.isArray(s.lignes) ? s.lignes : []) {
				const nature = String(l.nature || "").toLowerCase();
				const jours = (Array.isArray(l.profils) ? l.profils : []).reduce((t, p) => t + arrondiDemi(p.jours), 0);
				const groupe =
					nature === "recurrent" ? "En continu" : nature === "catalogue" ? "À la commande" : "Construction";
				if (groupe !== "En continu" && jours <= 0) continue;
				const cle = normal(l.designation);
				if (!cle || vues.has(cle)) continue;
				vues.add(cle);
				const par = groupe === "En continu" ? ` / ${l.unite || "an"}` : groupe === "À la commande" ? " / unité" : "";
				const qte = groupe === "Construction" && Number(l.quantite) > 1 ? Number(l.quantite) : 1;
				out.push({
					designation: String(l.designation).trim(),
					groupe,
					charge: jours ? `${fmt(jours * qte)} j${par}` : "",
				});
			}
		}
	const rang = { Construction: 0, "À la commande": 1, "En continu": 2 };
	return out.sort((x, y) => rang[x.groupe] - rang[y.groupe]);
}

function consigne(arretes) {
	const ls = lignes(arretes);
	if (!ls.length) return "";
	return [
		"LIGNES DE LA FRISE DU PLANNING (une ligne du tableau de planning par poste, intitulé recopié tel quel, dans cet ordre ; aucune autre) :",
		...ls.map((l) => `- ${l.designation} [${l.groupe}]`),
	].join("\n");
}


const cellules = (ligne) =>
	String(ligne)
		.trim()
		.replace(/^\|/, "")
		.replace(/\|$/, "")
		.split("|")
		.map((c) => c.trim());

function colonnes(entete) {
	const noms = entete.map(normal);
	const at = (nom) => noms.indexOf(normal(nom));
	const c = {
		tache: at("Tâche"),
		groupe: at("Groupe"),
		charge: at("Charge"),
		debut: at("Début"),
		fin: at("Fin"),
		jalon: at("Jalon"),
	};
	return c.tache >= 0 && c.debut >= 0 && c.fin >= 0 ? c : null;
}

function chiffrer(md, arretes) {
	const ref = new Map(lignes(arretes).map((l) => [normal(l.designation), l]));
	if (!ref.size) return md;
	const L = String(md || "").split("\n");
	for (let i = 0; i < L.length; i++) {
		if (!/^\s*\|/.test(L[i]) || !/^\s*\|[\s:|-]+\|\s*$/.test(L[i + 1] || "")) continue;
		const c = colonnes(cellules(L[i]));
		if (!c) continue;
		let j = i + 2;
		while (j < L.length && /^\s*\|/.test(L[j])) j++;
		const rangs = [];
		const ecartes = [];
		for (const ligne of L.slice(i + 2, j)) {
			const cs = cellules(ligne);
			const poste = ref.get(normal(cs[c.tache]));
			if (!poste) {
				ecartes.push(cs[c.tache]);
				continue;
			}
			const val = (k) => (k >= 0 ? cs[k] || "" : "");
			rangs.push(
				`| ${poste.designation} | ${poste.charge} | ${poste.groupe} | ${val(c.debut)} | ${val(c.fin)} | ${val(c.jalon)} |`,
			);
		}
		if (ecartes.length)
			console.log(`   → frise : ${ecartes.length} ligne(s) hors chiffrage écartée(s) : ${ecartes.join(" ; ")}`);
		L.splice(i, j - i, "| Tâche | Charge | Groupe | Début | Fin | Jalon |", "|---|---|---|---|---|---|", ...rangs);
		i += rangs.length + 1;
	}
	return L.join("\n");
}


function instant(v) {
	const m = String(v || "")
		.trim()
		.match(/^(?:(m|mois|s|sem(?:aine)?)\s*)?(\d{1,3})$/i);
	if (!m) return null;
	return { unite: /^s/i.test(m[1] || "") ? "S" : "M", n: Number(m[2]) };
}

function lire(rows) {
	const c = rows && rows.length > 1 ? colonnes(rows[0]) : null;
	if (!c) return null;
	const taches = [];
	for (const r of rows.slice(1)) {
		const de = instant(r[c.debut]);
		const a = instant(r[c.fin]);
		if (!de || !a || !r[c.tache]) continue;
		taches.push({
			tache: r[c.tache],
			charge: c.charge >= 0 ? r[c.charge] || "" : "",
			groupe: c.groupe >= 0 ? r[c.groupe] || "" : "",
			jalon: c.jalon >= 0 ? r[c.jalon] || "" : "",
			de,
			a,
		});
	}
	if (!taches.length) return null;
	const semaines = taches.every((t) => t.de.unite === "S" && t.a.unite === "S");
	const enMois = (x) => (x.unite === "S" ? Math.ceil(x.n / 4.35) : x.n);
	for (const t of taches) {
		t.de = semaines ? t.de.n : enMois(t.de);
		t.a = Math.max(t.de, semaines ? t.a.n : enMois(t.a));
	}
	const total = Math.max(...taches.map((t) => t.a));
	let pas = 1;
	let nom = (k) => (semaines ? ((k - 1) % 4 ? "" : `S${k}`) : `M${k}`);
	let bandeau = null;
	if (semaines && total > 26) return null;
	if (semaines) bandeau = { taille: 4, nom: (b) => `Mois ${b}` };
	else if (total > 24) {
		pas = 3;
		nom = (k) => `T${((k - 1) % 4) + 1}`;
		bandeau = { taille: 4, nom: (b) => `Année ${b}` };
	} else if (total > 12) bandeau = { taille: 12, nom: (b) => `Année ${b}` };
	const n = Math.ceil(total / pas);
	const colonnesGrille = Array.from({ length: n }, (_, k) => nom(k + 1));
	const bandeaux = bandeau
		? Array.from({ length: Math.ceil(n / bandeau.taille) }, (_, b) => ({
				nom: bandeau.nom(b + 1),
				de: b * bandeau.taille,
				a: Math.min(n, (b + 1) * bandeau.taille) - 1,
			}))
		: [];
	return {
		colonnes: colonnesGrille,
		bandeaux,
		taches: taches.map((t) => ({ ...t, de: Math.floor((t.de - 1) / pas), a: Math.floor((t.a - 1) / pas) })),
	};
}

module.exports = { EN_TETE, lignes, consigne, chiffrer, lire, instant };
