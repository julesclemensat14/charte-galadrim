const fs = require("fs");
const os = require("os");
const path = require("path");
const AdmZip = require("adm-zip");
const { corpsWord } = require("./docxedit");
const { parseBlocks, stripFences, dimensionnerTableau, numeroDeTitre } = require("./docxgen");
const couverture = require("./couverture");
const visuels = require("./visuels");


const GABARIT = path.join(__dirname, "../templates/reference.docx");

const STYLE = { h2: "Heading1", h3: "Heading2", h4: "Heading3" };

const CONTENT_DXA = 9264;
const ENCRE = "262524";
const VERT = "528361";
const HEADER_FILL = ENCRE;
const FILET = "CFC9C1";
const ZEBRE = "F3EFEA";
const MONO = '<w:rFonts w:ascii="Fira Mono" w:hAnsi="Fira Mono" w:cs="Fira Mono"/>';

const CORPS_SZ = 20;
const CORPS_RPR = `<w:sz w:val="${CORPS_SZ}"/><w:szCs w:val="${CORPS_SZ}"/>`;

const APRES_TITRE = { Heading1: 200, Heading2: 180, Heading3: 160 };

const xmlEsc = (s) =>
	String(s == null ? "" : s)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");


const LIEN_RPR = `<w:color w:val="${ENCRE}"/><w:u w:val="single"/>`;
let liensCollectes = [];
function refLien(url) {
	const rId = `rIdLien${liensCollectes.length + 1}`;
	liensCollectes.push({ rId, url });
	return rId;
}
function ajouterLiens(zip, liens) {
	if (!liens.length) return;
	const relsPath = "word/_rels/document.xml.rels";
	const ajouts = liens
		.map(
			({ rId, url }) =>
				`<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xmlEsc(url).replace(/"/g, "&quot;")}" TargetMode="External"/>`,
		)
		.join("");
	const rels = zip.readAsText(relsPath).replace("</Relationships>", `${ajouts}</Relationships>`);
	zip.updateFile(relsPath, Buffer.from(rels, "utf8"));
}

let renvoisCibles = new Map();

const INLINE_RE =
	/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(\[À COMPLÉTER[^\]]*\])|\*\*(.+?)\*\*|`(.+?)`|_\*\*(.+?)\*\*_|\*(.+?)\*|((?:[Cc]f\.|[Vv]oir|[Pp]artie|[Ss]ection|[Cc]hapitre|§)\s*(?:§\s*)?)(\d+(?:\.\d+)+)|(Annexes?\s+(\d+))/g;
function runsXml(text, baseRpr = "") {
	const run = (t, rpr) =>
		t ? `<w:r><w:rPr>${baseRpr}${rpr}</w:rPr><w:t xml:space="preserve">${xmlEsc(t)}</w:t></w:r>` : "";
	let out = "";
	let last = 0;
	let m;
	const re = new RegExp(INLINE_RE.source, "g");
	while ((m = re.exec(text))) {
		out += run(text.slice(last, m.index), "");
		if (m[2] !== undefined)
			out += `<w:hyperlink r:id="${refLien(m[2])}">${runsXml(m[1], baseRpr + LIEN_RPR)}</w:hyperlink>`;
		else if (m[3]) out += run(m[3], '<w:b/><w:highlight w:val="yellow"/>');
		else if (m[4] !== undefined) out += runsXml(m[4], baseRpr + "<w:b/>");
		else if (m[5] !== undefined) out += run(m[5], '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>');
		else if (m[6] !== undefined) out += runsXml(m[6], baseRpr + "<w:b/><w:i/>");
		else if (m[7] !== undefined) out += runsXml(m[7], baseRpr + "<w:i/>");
		else if (m[9] !== undefined) {
			out += run(m[8], "");
			const cible = renvoisCibles.get(m[9]);
			out += cible
				? `<w:hyperlink w:anchor="${cible.name}">${run(cible.numero, LIEN_RPR)}</w:hyperlink>`
				: run(m[9], "");
		} else if (m[10] !== undefined) {
			const cible = renvoisCibles.get(`annexe:${m[11]}`);
			out += cible ? `<w:hyperlink w:anchor="${cible.name}">${run(m[10], LIEN_RPR)}</w:hyperlink>` : run(m[10], "");
		}
		last = re.lastIndex;
	}
	out += run(text.slice(last), "");
	return out || '<w:r><w:t xml:space="preserve"></w:t></w:r>';
}

const paraXml = (styleId, inner, extraPpr = "") =>
	`<w:p><w:pPr>${styleId ? `<w:pStyle w:val="${styleId}"/>` : ""}${extraPpr}</w:pPr>${inner}</w:p>`;

const APRES_PARA = 140;
const APRES_PUCE = 60;

const CLOTURE = /^\s*fait à /i;

const bodyParaXml = (text) =>
	paraXml(
		"Normal",
		runsXml(text, CORPS_RPR),
		`<w:spacing${CLOTURE.test(text) ? ' w:before="480"' : ""} w:after="${APRES_PARA}"/><w:jc w:val="both"/>`,
	);
const bulletXml = (text) =>
	paraXml(
		"Normal",
		`<w:r><w:rPr>${MONO}<w:color w:val="${VERT}"/>${CORPS_RPR}</w:rPr><w:t xml:space="preserve">→ </w:t></w:r>${runsXml(text, CORPS_RPR)}`,
		`<w:spacing w:after="${APRES_PUCE}"/><w:ind w:left="360" w:hanging="360"/>`,
	);
const pageBreakXml = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

function tableXml(rows) {
	const { pt, widths, verticales, centrees, hauteurEnTete } = dimensionnerTableau(rows, {
		utile: CONTENT_DXA,
		carParPt: 13,
		pad: 240,
	});
	const cols = widths.length;
	const sz = Math.round(pt * 2);
	const rpr = `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>`;
	const grid = `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>`;
	const borders =
		'<w:top w:val="nil"/><w:left w:val="nil"/>' +
		`<w:bottom w:val="single" w:sz="4" w:space="0" w:color="${ENCRE}"/><w:right w:val="nil"/>` +
		`<w:insideH w:val="dashed" w:sz="4" w:space="0" w:color="${FILET}"/><w:insideV w:val="nil"/>`;
	const sensVertical = '<w:textDirection w:val="btLr"/>';
	const basDeCase = '<w:vAlign w:val="bottom"/>';
	const cell = (txt, j, header, zebre) => {
		const shd = `<w:shd w:val="clear" w:color="auto" w:fill="${header ? HEADER_FILL : zebre ? ZEBRE : "FFFFFF"}"/>`;
		const inner = header
			? `<w:r><w:rPr><w:b/><w:color w:val="FFFFFF"/>${rpr}</w:rPr><w:t xml:space="preserve">${xmlEsc(txt)}</w:t></w:r>`
			: runsXml(txt, rpr);
		const vertical = header && verticales[j];
		const jc = centrees[j] && !vertical ? '<w:jc w:val="center"/>' : "";
		const sens = `${vertical ? sensVertical : ""}${header && hauteurEnTete ? basDeCase : ""}`;
		return `<w:tc><w:tcPr><w:tcW w:w="${widths[j]}" w:type="dxa"/>${shd}${sens}</w:tcPr>${paraXml("Normal", inner, jc)}</w:tc>`;
	};
	const trs = rows
		.map((r, i) => {
			const cs = [...r];
			while (cs.length < cols) cs.push("");
			const head = i === 0;
			const zebre = i > 0 && i % 2 === 0;
			const hauteur = head && hauteurEnTete ? `<w:trHeight w:val="${hauteurEnTete}" w:hRule="atLeast"/>` : "";
			return `<w:tr>${head ? `<w:trPr><w:tblHeader/>${hauteur}</w:trPr>` : ""}${cs.map((c, j) => cell(c, j, head, zebre)).join("")}</w:tr>`;
		})
		.join("");
	const largeur = widths.reduce((a, b) => a + b, 0);
	return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="${largeur}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>${borders}</w:tblBorders></w:tblPr>${grid}${trs}</w:tbl><w:p/>`;
}

const encadreXml = (lines) =>
	paraXml(
		"Normal",
		runsXml(lines.join(" "), '<w:sz w:val="24"/><w:szCs w:val="24"/>'),
		`<w:pBdr><w:left w:val="single" w:sz="24" w:space="12" w:color="${VERT}"/></w:pBdr>` +
			'<w:shd w:val="clear" w:color="auto" w:fill="FFFFFF"/>' +
			'<w:spacing w:before="240" w:after="280" w:line="300" w:lineRule="auto"/><w:ind w:left="260" w:right="200"/>',
	);

function chiffresCles(id) {
	const tuiles = [];
	if (id.effectif) tuiles.push({ valeur: `${id.effectif}+`, libelle: "Collaborateurs" });
	const [dernier, avant] = id.chiffreAffaires || [];
	const montant = (c) => Number(String(c.montant).replace(/\D/g, ""));
	if (dernier && montant(dernier))
		tuiles.push({
			valeur: `${(montant(dernier) / 1e6).toFixed(1).replace(".", ",")}\u00a0M€`,
			libelle: `Chiffre d'affaires ${dernier.annee}`,
		});
	const hausse = dernier && avant && montant(avant) ? Math.round((montant(dernier) / montant(avant) - 1) * 100) : 0;
	if (hausse > 0) tuiles.push({ valeur: `+${hausse}\u00a0%`, libelle: `Croissance ${avant.annee}-${dernier.annee}` });
	const siege = (String(id.adresseBureaux || "").match(/\d{5}\s+([^,]+)/) || [])[1];
	const villes = [siege, ...Object.keys(id.bureauxRegionaux || {})].filter(Boolean);
	if (villes.length) tuiles.push({ valeur: String(villes.length), libelle: `Bureaux : ${villes.join(", ")}` });
	return tuiles;
}

const PAPIER = "F8F5F1";
function tuilesXml(tuiles) {
	if (!tuiles.length) return "";
	const w = Math.floor(CONTENT_DXA / tuiles.length);
	const ecart = `w:val="single" w:sz="36" w:space="0" w:color="${PAPIER}"`;
	const cases = tuiles
		.map(
			(t, j) =>
				`<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/><w:tcBorders><w:top ${ecart}/><w:left ${ecart}/><w:bottom ${ecart}/><w:right ${ecart}/></w:tcBorders>` +
				`<w:shd w:val="clear" w:color="auto" w:fill="${j === tuiles.length - 1 ? VERT : ENCRE}"/></w:tcPr>` +
				paraXml(
					"Normal",
					`<w:r><w:rPr><w:color w:val="FFFFFF"/><w:sz w:val="44"/><w:szCs w:val="44"/></w:rPr><w:t xml:space="preserve">${xmlEsc(t.valeur)}</w:t></w:r>`,
					'<w:spacing w:before="40" w:after="340" w:line="240" w:lineRule="auto"/>',
				) +
				paraXml(
					"Normal",
					`<w:r><w:rPr>${MONO}<w:caps/><w:color w:val="E6E3DE"/><w:sz w:val="13"/><w:szCs w:val="13"/></w:rPr><w:t xml:space="preserve">${xmlEsc(t.libelle)}</w:t></w:r>`,
					'<w:spacing w:before="0" w:after="40" w:line="240" w:lineRule="auto"/>',
				) +
				(t.precision ? ligneXml(t.precision, rprTaille(15, "E6E3DE")) : "") +
				"</w:tc>",
		)
		.join("");
	return (
		`<w:tbl><w:tblPr><w:tblW w:w="${w * tuiles.length}" w:type="dxa"/><w:tblLayout w:type="fixed"/>` +
		'<w:tblCellMar><w:top w:w="160" w:type="dxa"/><w:left w:w="180" w:type="dxa"/><w:bottom w:w="120" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
		`<w:tblGrid>${tuiles.map(() => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid><w:tr><w:trPr><w:cantSplit/></w:trPr>${cases}</w:tr></w:tbl><w:p/>`
	);
}
const tuilesGaladrim = () => {
	try {
		return tuilesXml(chiffresCles(require("./identite").parse()));
	} catch {
		return "";
	}
};

const ORANGE = "EC6A2C";
const TEINTES = [ENCRE, VERT, "D9D3CA"];
const teinteDe = (groupe, ordre) =>
	/continu/i.test(groupe)
		? TEINTES[2]
		: /commande|agent/i.test(groupe)
			? VERT
			: /construction/i.test(groupe)
				? ENCRE
				: TEINTES[ordre % 3];
function friseXml(rows) {
	const f = require("./frise").lire(rows);
	if (!f) return "";
	const LIB = 3000;
	const n = f.colonnes.length;
	const w = Math.floor((CONTENT_DXA - LIB) / n);
	const groupes = [...new Set(f.taches.map((t) => t.groupe))];
	const txt = (t, rpr, jc = "") =>
		`<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>${jc}</w:pPr><w:r><w:rPr>${rpr}</w:rPr><w:t xml:space="preserve">${xmlEsc(t)}</w:t></w:r></w:p>`;
	const mono = (sz, couleur) =>
		`${MONO}<w:caps/><w:color w:val="${couleur}"/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>`;
	const tc = (largeur, contenu, { span = 1, bordures = "", marges = "" } = {}) =>
		`<w:tc><w:tcPr><w:tcW w:w="${largeur}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ""}` +
		`${bordures ? `<w:tcBorders>${bordures}</w:tcBorders>` : ""}${marges}<w:vAlign w:val="center"/></w:tcPr>${contenu || "<w:p/>"}</w:tc>`;
	const tiret = `w:val="dashed" w:sz="4" w:space="0" w:color="${FILET}"`;
	const trait = `w:val="single" w:sz="6" w:space="0" w:color="${ENCRE}"`;
	const barreXml = (teinte) =>
		`<w:p><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="${teinte}"/><w:spacing w:before="0" w:after="0" w:line="190" w:lineRule="exact"/></w:pPr>` +
		`<w:r><w:rPr><w:sz w:val="4"/><w:szCs w:val="4"/></w:rPr><w:t xml:space="preserve"> </w:t></w:r></w:p>`;
	const debutDeBandeau = new Set(f.bandeaux.length ? f.bandeaux.map((b) => b.de) : f.colonnes.map((_, k) => k));
	let lignes = "";
	if (f.bandeaux.length)
		lignes +=
			`<w:tr>${tc(LIB, "")}` +
			f.bandeaux.map((b) => tc(w * (b.a - b.de + 1), txt(b.nom, mono(15, ENCRE)), { span: b.a - b.de + 1 })).join("") +
			"</w:tr>";
	lignes +=
		`<w:tr><w:trPr><w:tblHeader/></w:trPr>${tc(LIB, "", { bordures: `<w:bottom ${trait}/>` })}` +
		f.colonnes
			.map((c) => tc(w, txt(c, mono(12, "6F6E6C"), '<w:jc w:val="center"/>'), { bordures: `<w:bottom ${trait}/>` }))
			.join("") +
		"</w:tr>";
	let groupe = null;
	for (const t of f.taches) {
		if (t.groupe && t.groupe !== groupe) {
			groupe = t.groupe;
			lignes += `<w:tr><w:trPr><w:cantSplit/></w:trPr>${tc(LIB + w * n, `<w:p><w:pPr><w:keepNext/><w:spacing w:before="160" w:after="40"/></w:pPr><w:r><w:rPr>${mono(14, "6F6E6C")}</w:rPr><w:t xml:space="preserve">${xmlEsc(groupe)}</w:t></w:r></w:p>`, { span: n + 1 })}</w:tr>`;
		}
		const teinte = teinteDe(t.groupe, groupes.indexOf(t.groupe));
		const jalonApres = t.jalon && n - t.a - 1 >= 3;
		const sousNom = [t.charge, t.jalon && !jalonApres ? `◆ ${t.jalon}` : ""].filter(Boolean).join(" · ");
		let cases = "";
		for (let k = 0; k < n; k++) {
			if (jalonApres && k === t.a + 1) {
				cases += tc(w * (n - k), txt(`◆ ${t.jalon}`, mono(12, ORANGE)), {
					span: n - k,
					bordures: `<w:bottom ${tiret}/>`,
				});
				break;
			}
			const barre = k >= t.de && k <= t.a;
			cases += tc(w, barre ? barreXml(teinte) : "", {
				bordures: `${debutDeBandeau.has(k) ? `<w:left ${tiret}/>` : ""}<w:bottom ${tiret}/>`,
			});
		}
		lignes +=
			`<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="440" w:hRule="atLeast"/></w:trPr>` +
			tc(
				LIB,
				txt(t.tache, `<w:sz w:val="17"/><w:szCs w:val="17"/>`) + (sousNom ? txt(sousNom, mono(12, "6F6E6C")) : ""),
				{ bordures: `<w:bottom ${tiret}/>`, marges: '<w:tcMar><w:right w:w="160" w:type="dxa"/></w:tcMar>' },
			) +
			cases +
			"</w:tr>";
	}
	const legende = groupes
		.map(
			(g, k) =>
				`<w:r><w:rPr>${MONO}<w:color w:val="${teinteDe(g, k)}"/><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve">■ </w:t></w:r><w:r><w:rPr>${mono(13, "6F6E6C")}</w:rPr><w:t xml:space="preserve">${xmlEsc(g)}     </w:t></w:r>`,
		)
		.join("");
	const jalons = f.taches.some((t) => t.jalon)
		? `<w:r><w:rPr>${MONO}<w:color w:val="${ORANGE}"/><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve">◆ </w:t></w:r><w:r><w:rPr>${mono(13, "6F6E6C")}</w:rPr><w:t>Jalon</w:t></w:r>`
		: "";
	return (
		`<w:tbl><w:tblPr><w:tblW w:w="${LIB + w * n}" w:type="dxa"/><w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>` +
		`<w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
		`<w:tblGrid><w:gridCol w:w="${LIB}"/>${f.colonnes.map(() => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>${lignes}</w:tbl>` +
		`<w:p><w:pPr><w:spacing w:before="160" w:after="240"/></w:pPr>${legende}${jalons}</w:p>`
	);
}


const SANS_BORDURE =
	'<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>';
const tableauNu = (largeurs, lignes, marges = "") =>
	`<w:tbl><w:tblPr><w:tblW w:w="${largeurs.reduce((a, b) => a + b, 0)}" w:type="dxa"/>${SANS_BORDURE}<w:tblLayout w:type="fixed"/>${marges}</w:tblPr>` +
	`<w:tblGrid>${largeurs.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>${lignes}</w:tbl><w:p/>`;
const caseXml = (largeur, contenu, { fond = "", bordures = "", span = 1, vAlign = "" } = {}) =>
	`<w:tc><w:tcPr><w:tcW w:w="${largeur}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ""}` +
	`${bordures ? `<w:tcBorders>${bordures}</w:tcBorders>` : ""}${fond ? `<w:shd w:val="clear" w:color="auto" w:fill="${fond}"/>` : ""}` +
	`${vAlign ? `<w:vAlign w:val="${vAlign}"/>` : ""}</w:tcPr>${contenu || "<w:p/>"}</w:tc>`;
const ligneXml = (texte, rpr, ppr = "") =>
	paraXml("Normal", runsXml(texte, rpr), `<w:spacing w:before="0" w:after="40" w:line="240" w:lineRule="auto"/>${ppr}`);
const rprTaille = (sz, couleur = "") =>
	`${couleur ? `<w:color w:val="${couleur}"/>` : ""}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>`;
const rprMono = (sz, couleur) => `${MONO}<w:caps/>${rprTaille(sz, couleur)}`;
const numero2 = (k) => String(k + 1).padStart(2, "0");
const GRIS_TEXTE = "4A4744";

function etapesXml(items) {
	const k = items.length;
	const FLECHE = 300;
	const bloc = Math.floor((CONTENT_DXA - (k - 1) * FLECHE) / k);
	const largeurs = items.flatMap((_, j) => (j ? [FLECHE, bloc] : [bloc]));
	const fondDe = (j) => (j === k - 1 ? VERT : j % 2 ? "3B3937" : ENCRE);
	const tete = items
		.map((e, j) => {
			const blocXml = caseXml(
				bloc,
				ligneXml(numero2(j), rprMono(13, "D9D3CA")) + ligneXml(e.titre, `<w:b/>${rprTaille(21, "FFFFFF")}`),
				{ fond: fondDe(j), vAlign: "center" },
			);
			const fleche = caseXml(FLECHE, ligneXml("→", `${MONO}${rprTaille(26, VERT)}`, '<w:jc w:val="center"/>'), {
				vAlign: "center",
			});
			return j ? fleche + blocXml : blocXml;
		})
		.join("");
	const filet = `<w:top w:val="dashed" w:sz="6" w:space="0" w:color="${FILET}"/>`;
	const details = items
		.map((e, j) => {
			const texte = caseXml(bloc, ligneXml(e.texte, rprTaille(16, GRIS_TEXTE)), { bordures: filet });
			return j ? caseXml(FLECHE, "") + texte : texte;
		})
		.join("");
	return tableauNu(
		largeurs,
		`<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="900" w:hRule="atLeast"/></w:trPr>${tete}</w:tr>` +
			`<w:tr><w:trPr><w:cantSplit/></w:trPr>${details}</w:tr>`,
		'<w:tblCellMar><w:top w:w="120" w:type="dxa"/><w:left w:w="140" w:type="dxa"/><w:bottom w:w="120" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar>',
	);
}

function cartesXml(cartes) {
	const ECART = 100;
	const w = Math.floor((CONTENT_DXA - (cartes.length - 1) * ECART) / cartes.length);
	const cases = cartes
		.map(
			(c, j) =>
				(j ? caseXml(ECART, "") : "") +
				caseXml(
					w,
					ligneXml(numero2(j), rprMono(16, VERT)) +
						ligneXml(c.titre, `<w:b/>${rprTaille(22)}`, '<w:spacing w:before="60" w:after="100"/>') +
						ligneXml(c.texte, rprTaille(17, GRIS_TEXTE)),
					{
						fond: "FFFFFF",
						bordures: `<w:top w:val="single" w:sz="36" w:space="0" w:color="${VERT}"/>`,
					},
				),
		)
		.join("");
	return tableauNu(
		cartes.flatMap((_, j) => (j ? [ECART, w] : [w])),
		`<w:tr><w:trPr><w:cantSplit/></w:trPr>${cases}</w:tr>`,
		'<w:tblCellMar><w:top w:w="200" w:type="dxa"/><w:left w:w="200" w:type="dxa"/><w:bottom w:w="200" w:type="dxa"/><w:right w:w="160" w:type="dxa"/></w:tblCellMar>',
	);
}

function avantApresXml({ entetes, lignes }) {
	const w = Math.floor(CONTENT_DXA / 2);
	const filet = `<w:bottom w:val="dashed" w:sz="6" w:space="0" w:color="${FILET}"/>`;
	const tete =
		caseXml(w, ligneXml(entetes[0], rprMono(15, "FFFFFF")), { fond: "8A847D" }) +
		caseXml(w, ligneXml(entetes[1], rprMono(15, "FFFFFF")), { fond: VERT });
	const corps = lignes
		.map(
			([avant, apres]) =>
				`<w:tr><w:trPr><w:cantSplit/></w:trPr>${caseXml(w, ligneXml(avant, rprTaille(18)), { bordures: filet })}` +
				`${caseXml(w, ligneXml(apres, rprTaille(18)), { fond: "FFFFFF", bordures: filet })}</w:tr>`,
		)
		.join("");
	return tableauNu(
		[w, w],
		`<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>${tete}</w:tr>${corps}`,
		'<w:tblCellMar><w:top w:w="110" w:type="dxa"/><w:left w:w="180" w:type="dxa"/><w:bottom w:w="110" w:type="dxa"/><w:right w:w="140" w:type="dxa"/></w:tblCellMar>',
	);
}

function jalonsXml(j) {
	const n = j.colonnes.length;
	const w = Math.floor(CONTENT_DXA / n);
	const pas = Math.ceil(n / 12);
	const reperes = j.colonnes.map((c, k) => caseXml(w, k % pas ? "" : ligneXml(c, rprMono(12, "6F6E6C")))).join("");
	const auJalon = new Set(j.points.map((p) => p.k));
	const barre = j.colonnes
		.map((_, k) =>
			caseXml(w, '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="120" w:lineRule="exact"/></w:pPr></w:p>', {
				fond: auJalon.has(k) ? VERT : j.couvert[k] ? ENCRE : "D9D3CA",
				bordures: `<w:right w:val="single" w:sz="4" w:space="0" w:color="${PAPIER}"/>`,
			}),
		)
		.join("");
	const largeur = Math.max(2, Math.ceil(n / 4));
	const trait = `w:val="single" w:sz="8" w:space="0" w:color="${ENCRE}"`;
	const etiquettes = visuels
		.rangerJalons(j.points, n, largeur)
		.map((ligne) => {
			let cases = "";
			let k = 0;
			for (const p of ligne) {
				for (; k < p.de; k++) cases += caseXml(w, "");
				const jc = p.aDroite ? '<w:jc w:val="right"/>' : "";
				cases += caseXml(
					w * (p.a - p.de + 1),
					ligneXml(p.quand, rprMono(13, VERT), jc) + ligneXml(p.nom, `<w:b/>${rprTaille(17)}`, jc),
					{ span: p.a - p.de + 1, bordures: p.aDroite ? `<w:right ${trait}/>` : `<w:left ${trait}/>` },
				);
				k = p.a + 1;
			}
			for (; k < n; k++) cases += caseXml(w, "");
			return `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cases}</w:tr>`;
		})
		.join("");
	return tableauNu(
		j.colonnes.map(() => w),
		`<w:tr>${reperes}</w:tr><w:tr><w:trPr><w:trHeight w:val="220" w:hRule="exact"/></w:trPr>${barre}</w:tr>${etiquettes}`,
		'<w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar>',
	);
}

function visuelDeTableau(rows) {
	const t = visuels.tuiles(rows);
	if (t) return tuilesXml(t);
	const c = visuels.cartes(rows);
	if (c) return cartesXml(c);
	const a = visuels.avantApres(rows);
	if (a) return avantApresXml(a);
	return "";
}


const sansNumero = (t) =>
	String(t == null ? "" : t)
		.replace(/^\s*(?:section|partie|chapitre)\s+\d+\s*(?:[—–-]|[.:])?\s*/i, "")
		.replace(/^\s*\d+(?:\.\d+)*[.)]?\s+/, "")
		.trim();

function numeroteur() {
	const c = [0, 0, 0];
	return (level) => {
		c[level - 1]++;
		for (let i = level; i < c.length; i++) c[i] = 0;
		for (let i = 0; i < level - 1; i++) if (!c[i]) c[i] = 1;
		return c.slice(0, level).join(".") + (level === 1 ? "." : "");
	};
}

const NUMERO_SZ = { Heading1: 26, Heading2: 20, Heading3: 18 };
const numeroXml = (styleId, text) => {
	const m = String(text).match(/^(\d+(?:\.\d+)*\.?)\s+/);
	if (!m || !NUMERO_SZ[styleId]) return { numero: "", reste: text };
	const sz = NUMERO_SZ[styleId];
	return {
		numero: `<w:r><w:rPr>${MONO}<w:color w:val="${VERT}"/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr><w:t xml:space="preserve">${m[1]}  </w:t></w:r>`,
		reste: text.slice(m[0].length),
	};
};
const headingXml = (styleId, text, bm, name, pPrExtra, rpr = "") => {
	const { numero, reste } = numeroXml(styleId, text);
	return (
		`<w:p><w:pPr><w:pStyle w:val="${styleId}"/>${pPrExtra || `<w:spacing w:after="${APRES_TITRE[styleId] || 160}"/>`}</w:pPr>` +
		`<w:bookmarkStart w:id="${bm}" w:name="${name}"/>${numero}${runsXml(reste, rpr)}<w:bookmarkEnd w:id="${bm}"/></w:p>`
	);
};

const NIVEAU = { h1: 1, h2: 1, h3: 2, h4: 3 };
const estPreface = (level, text) => level === 1 && visuels.COUP_D_OEIL.test(text);

const normal = (t) =>
	String(t == null ? "" : t)
		.replace(/[*_`]/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase();

const CARTE_MARGE = 280;
const carteXml = (inner, w) =>
	`<w:tbl><w:tblPr><w:tblW w:w="${w}" w:type="dxa"/><w:jc w:val="center"/><w:tblBorders>` +
	["top", "left", "bottom", "right"]
		.map((b) => `<w:${b} w:val="single" w:sz="4" w:space="0" w:color="E2DDD6"/>`)
		.join("") +
	`</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="${CARTE_MARGE}" w:type="dxa"/><w:left w:w="${CARTE_MARGE}" w:type="dxa"/>` +
	`<w:bottom w:w="${CARTE_MARGE}" w:type="dxa"/><w:right w:w="${CARTE_MARGE}" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
	`<w:tblGrid><w:gridCol w:w="${w}"/></w:tblGrid><w:tr><w:trPr><w:cantSplit/></w:trPr><w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>` +
	`<w:shd w:val="clear" w:color="auto" w:fill="FFFFFF"/></w:tcPr>${inner}</w:tc></w:tr></w:tbl>`;

function figureXml(zip, figure, n, opts = {}) {
	if (!zip) return "";
	let buf = null;
	try {
		buf = fs.readFileSync(figure.image);
	} catch {
		return "";
	}
	const taille = taillePng(buf);
	if (!taille) return "";
	const utile = opts.utileDxa > 0 ? opts.utileDxa : CONTENT_DXA;
	const nsA = opts.nsLocal ? ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' : "";
	const nsPic = opts.nsLocal ? ' xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"' : "";
	const boite = opts.carte ? utile - 2 * CARTE_MARGE : utile;
	const cx = Math.round(boite * EMU_PAR_TWIP * fractionLargeur(figure.largeur));
	const cy = Math.round((cx * taille.h) / taille.w);
	const rId = ajouterMedia(zip, buf, `corps${n}`);
	const id = 950 + (parseInt(String(n).replace(/\D/g, ""), 10) || 0);
	const espace = opts.carte
		? '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>'
		: '<w:spacing w:before="160" w:after="60"/>';
	const image =
		`<w:p><w:pPr>${figure.muette ? "" : "<w:keepNext/>"}${espace}<w:jc w:val="center"/></w:pPr><w:r><w:drawing>` +
		`<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
		`<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${id}" name="Figure ${n}"/>` +
		`<wp:cNvGraphicFramePr><a:graphicFrameLocks${nsA} noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
		`<a:graphic${nsA}><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
		`<pic:pic${nsPic}><pic:nvPicPr><pic:cNvPr id="${id}" name="figure${n}.png"/><pic:cNvPicPr/></pic:nvPicPr>` +
		`<pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
		`<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
		`<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
		`</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
	return (
		(opts.carte
			? carteXml(image, Math.round(cx / EMU_PAR_TWIP) + 2 * CARTE_MARGE) +
				'<w:p><w:pPr><w:spacing w:before="0" w:after="120"/></w:pPr></w:p>'
			: image) +
		(figure.muette
			? ""
			: paraXml(
					"Normal",
					runsXml(figure.legende, `${CORPS_RPR}<w:i/><w:color w:val="6F6E6C"/>`),
					'<w:spacing w:after="180"/><w:jc w:val="center"/>',
				))
	);
}

function bodyToXml(
	blocks,
	{ annexes = [], figuresCorps = [], zip = null, numeroter = true, ouvreLaPage = false } = {},
) {
	const toc = [];
	const titres = new Map();
	const cibles = { source: new Map(), rendu: new Map() };
	const numero = numeroteur();
	let bm = 0;
	blocks.forEach((b, i) => {
		const level = NIVEAU[b.t];
		if (!level) return;
		const num = numeroter && !estPreface(level, b.text) ? numero(level) : "";
		const text = `${num} ${sansNumero(b.text)}`.trim();
		bm++;
		const name = `_Toc${90000 + bm}`;
		const styleId = level === 1 ? STYLE.h2 : level === 2 ? STYLE.h3 : STYLE.h4;
		titres.set(i, { styleId, text, name, bm });
		toc.push({ level, text, name });
		const cible = { name, numero: num.replace(/\.$/, "") };
		const source = numeroDeTitre(b.text);
		if (source && !cibles.source.has(source)) cibles.source.set(source, cible);
		if (!cibles.rendu.has(cible.numero)) cibles.rendu.set(cible.numero, cible);
	});
	renvoisCibles = new Map([...cibles.rendu, ...cibles.source]);
	annexes.forEach((a, i) => renvoisCibles.set(`annexe:${i + 1}`, { name: `_Toc${90000 + bm + i + 1}` }));

	const parLegende = new Map(figuresCorps.filter((f) => f && f.legende).map((f) => [normal(f.legende), f]));

	let out = ouvreLaPage ? "" : pageBreakXml;
	let media = 0;
	let premierTitre = true;
	let tuilesEnAttente = false;
	const poserTuiles = () => {
		if (!tuilesEnAttente) return "";
		tuilesEnAttente = false;
		return tuilesGaladrim();
	};
	const iPlanning = blocks.findIndex((b) => b.t === "table" && require("./frise").lire(b.rows));
	const frise = iPlanning >= 0 ? visuels.jalons(blocks[iPlanning].rows) : null;
	const partieDuPlanning = [...titres.keys()].filter((k) => k < iPlanning && titres.get(k).styleId === STYLE.h2).pop();
	let jalonsEnAttente = null;
	let delaisServis = false;
	const poserJalons = () => {
		if (!jalonsEnAttente) return "";
		jalonsEnAttente = null;
		return jalonsXml(frise);
	};
	let sauter = 0;
	for (const [i, b] of blocks.entries()) {
		if (sauter) {
			sauter--;
			continue;
		}
		const titre = titres.get(i);
		const figure = b.t === "p" ? parLegende.get(normal(b.text)) : null;
		const etapes = b.t === "p" && !figure ? visuels.etapes(blocks, i) : null;
		if (titre) {
			out += poserTuiles() + poserJalons();
			const sansSaut =
				ouvreLaPage && premierTitre
					? `<w:pageBreakBefore w:val="0"/><w:spacing w:after="${APRES_TITRE[titre.styleId] || 160}"/>`
					: undefined;
			premierTitre = false;
			out += headingXml(titre.styleId, titre.text, titre.bm, titre.name, sansSaut);
			tuilesEnAttente = titre.styleId === STYLE.h2 && /pr[ée]sentation de galadrim/i.test(titre.text);
			if (frise && titre.styleId === STYLE.h2) {
				jalonsEnAttente = visuels.COUP_D_OEIL.test(titre.text) ? "coup" : null;
				if (!delaisServis && visuels.DELAIS.test(titre.text) && i !== partieDuPlanning) {
					jalonsEnAttente = "delais";
					delaisServis = true;
				}
			}
		} else if (figure) out += figureXml(zip, figure, ++media, { carte: true }) || bodyParaXml(b.text);
		else if (etapes) {
			out += etapesXml(etapes);
			sauter = etapes.length - 1;
		} else if (b.t === "p")
			out += bodyParaXml(b.text) + poserTuiles() + (jalonsEnAttente === "delais" ? poserJalons() : "");
		else if (b.t === "li") out += bulletXml(b.text);
		else if (b.t === "table")
			out +=
				(jalonsEnAttente === "coup" && visuels.avantApres(b.rows) ? poserJalons() : "") +
				(friseXml(b.rows) || visuelDeTableau(b.rows) || tableXml(b.rows));
		else if (b.t === "quote") out += encadreXml(b.lines);
		else if (b.t === "hr") out += "<w:p/>";
	}
	out += poserTuiles() + poserJalons();
	return { xml: out, toc, bm };
}


const EMU_PAR_TWIP = 635;
const TITRE_DXA = 1700;
const TITRE_PPR = '<w:spacing w:before="0" w:after="120"/>';
const TITRE_ANNEXE_RPR = '<w:sz w:val="32"/><w:szCs w:val="32"/>';

const MARGE_ANNEXE_BAS = 1200;
function sectPrPaysage(sectPr) {
	return sectPr
		.replace(/<w:pgNumType\b[^>]*\/>/, "")
		.replace(/<w:titlePg\/>/, "")
		.replace(/<w:pgSz\b([^>]*)\/>/, (balise, attrs) => {
			const w = Number((attrs.match(/w:w="(\d+)"/) || [])[1]);
			const h = Number((attrs.match(/w:h="(\d+)"/) || [])[1]);
			if (!w || !h) return balise;
			return `<w:pgSz w:w="${Math.max(w, h)}" w:h="${Math.min(w, h)}" w:orient="landscape"/>`;
		})
		.replace(/<w:pgMar\b([^>]*)\/>/, (balise, attrs) => {
			const bas = Number((attrs.match(/w:bottom="(\d+)"/) || [])[1]);
			if (!bas || bas <= MARGE_ANNEXE_BAS) return balise;
			return `<w:pgMar${attrs.replace(/w:bottom="\d+"/, `w:bottom="${MARGE_ANNEXE_BAS}"`)}/>`;
		});
}

function boiteUtile(sectPr) {
	const nb = (re) => Number((sectPr.match(re) || [])[1] || 0);
	const w =
		nb(/<w:pgSz\b[^>]*\bw:w="(\d+)"/) - nb(/<w:pgMar\b[^>]*\bw:left="(\d+)"/) - nb(/<w:pgMar\b[^>]*\bw:right="(\d+)"/);
	const h =
		nb(/<w:pgSz\b[^>]*\bw:h="(\d+)"/) - nb(/<w:pgMar\b[^>]*\bw:top="(\d+)"/) - nb(/<w:pgMar\b[^>]*\bw:bottom="(\d+)"/);
	return w > 0 && h > TITRE_DXA ? { w, h: h - TITRE_DXA } : { w: CONTENT_DXA, h: 11000 };
}

const sectionBreakXml = (sectPr) => `<w:p><w:pPr>${sectPr}</w:pPr></w:p>`;

function taillePng(buf) {
	if (!buf || buf.length < 24 || buf.readUInt32BE(12) !== 0x49484452) return null;
	const w = buf.readUInt32BE(16);
	const h = buf.readUInt32BE(20);
	return w && h ? { w, h } : null;
}

const fractionLargeur = (v) => Math.min(1, Math.max(0.25, Number(v) || 1));

function tailleRendue(buf, largeur = 1) {
	const t = taillePng(buf);
	if (!t) return null;
	const pouces = (CONTENT_DXA * fractionLargeur(largeur)) / 1440;
	return {
		px: t,
		cm: { w: pouces * 2.54, h: ((pouces * 2.54) / t.w) * t.h },
		dpi: Math.round(t.w / pouces),
	};
}

function ajouterMedia(zip, buffer, n) {
	const nom = `annexe${n}.png`;
	zip.addFile(`word/media/${nom}`, buffer);
	const relsPath = "word/_rels/document.xml.rels";
	const rId = `rIdAnnexe${n}`;
	const rels = zip
		.readAsText(relsPath)
		.replace(
			"</Relationships>",
			`<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${nom}"/></Relationships>`,
		);
	zip.updateFile(relsPath, Buffer.from(rels, "utf8"));
	return rId;
}

function imageXml(rId, n, { w, h }, boite) {
	const maxW = boite.w * EMU_PAR_TWIP;
	const maxH = boite.h * EMU_PAR_TWIP;
	const echelle = Math.min(maxW / (w * 9525), maxH / (h * 9525), 1);
	const cx = Math.round(w * 9525 * echelle);
	const cy = Math.round(h * 9525 * echelle);
	return (
		`<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:drawing>` +
		`<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
		`<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${900 + n}" name="Annexe ${n}"/>` +
		`<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
		`<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
		`<pic:pic><pic:nvPicPr><pic:cNvPr id="${900 + n}" name="annexe${n}.png"/><pic:cNvPicPr/></pic:nvPicPr>` +
		`<pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
		`<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
		`<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
		`</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
	);
}

function annexesXml(zip, annexes, bmDepart, sectPr) {
	let xml = "";
	const toc = [];
	let bm = bmDepart;
	let n = 0;
	renvoisCibles = new Map();
	const sectPrAnnexes = sectPrPaysage(sectPr);
	const boite = boiteUtile(sectPrAnnexes);
	for (const a of annexes) {
		let buf = null;
		try {
			buf = fs.readFileSync(a.image);
		} catch {
			continue;
		}
		const taille = taillePng(buf);
		if (!taille) continue;
		n++;
		bm++;
		const name = `_Toc${90000 + bm}`;
		toc.push({ level: 1, text: a.titre, name, annexe: true });
		xml +=
			(n === 1 ? sectionBreakXml(sectPr) : "") +
			headingXml(STYLE.h2, a.titre, bm, name, TITRE_PPR, TITRE_ANNEXE_RPR) +
			carteXml(
				imageXml(ajouterMedia(zip, buf, n), n, taille, {
					w: boite.w - 2 * CARTE_MARGE,
					h: boite.h - 2 * CARTE_MARGE,
				}),
				boite.w,
			);
	}
	return { xml, toc, sectPr: n ? sectPrAnnexes : sectPr };
}


const TOC_HEADING_STYLE = "En-ttedetabledesmatires";

const plainText = (t) =>
	String(t == null ? "" : t)
		.replace(/\*\*(.+?)\*\*/g, "$1")
		.replace(/`(.+?)`/g, "$1")
		.replace(/\*(.+?)\*/g, "$1");

function tocEntryXml({ level, text, name }) {
	const titre = plainText(text);
	const m = level === 1 ? titre.match(/^(\d+\.)\s+/) : null;
	const numero = m
		? `<w:r><w:rPr>${MONO}<w:color w:val="${VERT}"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:t xml:space="preserve">${m[1]}  </w:t></w:r>`
		: "";
	return (
		`<w:p><w:pPr><w:pStyle w:val="TOC${level}"/></w:pPr>` +
		`<w:hyperlink w:anchor="${name}">${numero}` +
		`<w:r><w:t xml:space="preserve">${xmlEsc(m ? titre.slice(m[0].length) : titre)}</w:t></w:r>` +
		`<w:r><w:tab/></w:r>` +
		`<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
		`<w:r><w:instrText xml:space="preserve"> PAGEREF ${name} \\h </w:instrText></w:r>` +
		`<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
		`<w:r><w:t>1</w:t></w:r>` +
		`<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
		`</w:hyperlink></w:p>`
	);
}

function sommaireXml(toc) {
	const titre = `<w:p><w:pPr><w:pStyle w:val="${TOC_HEADING_STYLE}"/></w:pPr>${runsXml("Sommaire")}</w:p>`;
	const champ =
		`<w:p><w:pPr><w:rPr/></w:pPr>` +
		`<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
		`<w:r><w:instrText xml:space="preserve"> TOC \\h \\u \\z \\t &quot;Heading 1,1,Heading 2,2,Heading 3,3,&quot; </w:instrText></w:r>` +
		`<w:r><w:fldChar w:fldCharType="separate"/></w:r></w:p>` +
		toc.map(tocEntryXml).join("") +
		`<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`;
	return pageBreakXml + titre + champ;
}


const texteDePage = (t) =>
	String(t || "")
		.split("\n")
		.filter((l) => !/\.{4,}\s*\d*\s*$/.test(l))
		.join(" ")
		.replace(/\s+/g, " ")
		.toLowerCase();

function setTocPage(xml, name, page) {
	const re = new RegExp(`(PAGEREF ${name} [\\s\\S]*?fldCharType="separate"/></w:r>\\s*<w:r><w:t>)\\d+(</w:t>)`);
	return xml.replace(re, `$1${page}$2`);
}

function pagesDuSommaire(xml) {
	const pages = new Map();
	const re = /<w:hyperlink w:anchor="(_Toc\d+)">([\s\S]*?)<\/w:hyperlink>/g;
	for (const [, name, entree] of String(xml).matchAll(re)) {
		const titre = (entree.match(/<w:t\b[^>]*>([^<]*)<\/w:t>/) || [])[1] || "";
		const page = (entree.match(new RegExp(`PAGEREF ${name} [\\s\\S]*?<w:t>(\\d+)</w:t>`)) || [])[1];
		const numero = titre.trim().split(/\s/)[0];
		if (page && /^\d/.test(numero)) pages.set(numero, Number(page));
	}
	return pages;
}

async function numeroterSommaire(zip, doc, toc) {
	if (!toc.length) return null;
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "memoire_toc_"));
	try {
		const src = path.join(dir, "memoire.docx");
		fs.writeFileSync(src, zip.toBuffer());
		const pdf = await require("./prompts/formfiller").toPdf(src);
		if (!pdf) return null;

		const { PDFParse } = require("pdf-parse");
		const { pages } = await new PDFParse({ data: pdf }).getText();
		const textes = (pages || []).map((p) => texteDePage(p.text));

		let debut = 0;
		(pages || []).forEach((p, i) => {
			if (/\.{4,}\s*\d/.test(p.text || "")) debut = i + 1;
		});

		const pageDuTitre = (cle, depuis, annexe) => {
			let vue = -1;
			for (let k = depuis; k < textes.length; k++) {
				if (!cle || !textes[k].includes(cle)) continue;
				vue = k;
				if (!annexe) break;
			}
			return vue;
		};

		let out = doc;
		let depuis = debut;
		for (const e of toc) {
			const cle = plainText(e.text).replace(/\s+/g, " ").toLowerCase().trim();
			const i = pageDuTitre(cle, depuis, e.annexe);
			if (i < 0) continue;
			depuis = i;
			out = setTocPage(out, e.name, i + 1);
		}
		return out;
	} catch {
		return null;
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}


function setParaText(p, text) {
	let done = false;
	return p.replace(/<w:t\b[^>]*>[\s\S]*?<\/w:t>/g, () => {
		if (done) return '<w:t xml:space="preserve"></w:t>';
		done = true;
		return `<w:t xml:space="preserve">${xmlEsc(text)}</w:t>`;
	});
}

function identiteCouverture(adresseContacts) {
	try {
		const id = require("./identite").parse();
		const forme = (String(id.forme || "").match(/\(([^)]+)\)/) || [])[1] || "";
		const naf = String(id.ape || "").split(/\s+/)[0];
		const siret = [id.siren && `SIREN ${id.siren}`, naf && `NAF ${naf}`].filter(Boolean).join(" · ");
		return {
			raison: [id.denomination, forme].filter(Boolean).join(" "),
			adresse: adresseContacts || id.adresseBureaux || id.adresseSiege || "",
			immat: siret,
		};
	} catch {
		return { raison: "", adresse: "", immat: "" };
	}
}

function fillCover(coverXml, { objet, dateStr, sousTraitant, titre, mention, adresse }) {
	const stLines = sousTraitant ? String(sousTraitant).split("\n") : [];
	const ident = identiteCouverture(adresse);
	let n = 0;
	return coverXml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (p) => {
		n++;
		if (n === 1) return setParaText(p, `[${titre || TITRE_DEFAUT}]`);
		if (n === 2) return setParaText(p, objet || "");
		if (n === 3) return mention ? setParaText(p, mention) : "";
		if (n === 5) return setParaText(p, ident.raison || "Galadrim SAS");
		if (n === 6) return ident.adresse ? setParaText(p, ident.adresse) : "";
		if (n === 7) return ident.immat ? setParaText(p, ident.immat) : "";
		if (n === 8) return sousTraitant ? p : "";
		if (n === 9) return sousTraitant ? setParaText(p, stLines[0] || "") : "";
		if (n === 10) return sousTraitant ? setParaText(p, stLines[1] || "") : "";
		if (n === 11) return setParaText(p, dateStr || "");
		return p;
	});
}


function setCellText(tc, text) {
	const m = tc.match(/<w:p\b/);
	if (!m) return tc;
	const corps = tc.slice(m.index);
	const pPr = ((corps.match(/<w:pPr>[\s\S]*?<\/w:pPr>/) || [""])[0] || "").replace(
		/<w:jc w:val="[^"]*"\/>/,
		'<w:jc w:val="left"/>',
	);
	const rPr = (corps.match(/<w:r\b[^>]*>\s*(<w:rPr>[\s\S]*?<\/w:rPr>)/) || ["", ""])[1];
	const runs = String(text == null ? "" : text)
		.split("\n")
		.map((l, i) => `<w:r>${rPr}${i ? "<w:br/>" : ""}<w:t xml:space="preserve">${xmlEsc(l)}</w:t></w:r>`)
		.join("");
	return `${tc.slice(0, m.index)}<w:p>${pPr}${runs}</w:p></w:tc>`;
}

function tableauContacts(tbl, titre, lignes) {
	const trs = tbl.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) || [];
	if (trs.length < 2) return tbl;
	const modele = trs[1];
	const corps = lignes
		.map((l) => {
			let n = 0;
			return modele.replace(/<w:tc\b[\s\S]*?<\/w:tc>/g, (tc) => setCellText(tc, n++ === 0 ? l.label : l.value));
		})
		.join("");
	return tbl.slice(0, tbl.indexOf(trs[0])) + setParaText(trs[0], titre) + corps + "</w:tbl>";
}


const TITRE_DEFAUT = "Mémoire technique";

function couperCouverture(blocks) {
	let k = 0;
	let titre = null;
	if (blocks[k] && blocks[k].t === "h1") {
		titre = blocks[k].text;
		k++;
	}
	let objet = null;
	if (blocks[k] && blocks[k].t === "h2") {
		objet = blocks[k].text;
		k++;
	}
	const metaLines = [];
	while (blocks[k] && blocks[k].t === "p") {
		metaLines.push(blocks[k].text);
		k++;
	}
	if (blocks[k] && blocks[k].t === "hr") k++;
	return { k, titre, objet, metaLines };
}

function plan(md) {
	const blocks = parseBlocks(stripFences(md));
	const { k } = couperCouverture(blocks);
	const numero = numeroteur();
	const out = [];
	for (const b of blocks.slice(k)) {
		const level = NIVEAU[b.t];
		if (!level || estPreface(level, b.text)) continue;
		out.push({ level, numero: numero(level), titre: sansNumero(b.text) });
	}
	return out;
}

async function render(md, meta = {}) {
	const blocks = parseBlocks(stripFences(md));

	const { k, titre: titreMd, objet: objetMd, metaLines } = couperCouverture(blocks);
	const objet = meta.objet == null ? objetMd : meta.objet;
	const titre = meta.titre || titreMd || TITRE_DEFAUT;
	const bodyBlocks = blocks.slice(k);

	const dateStr = meta.date || metaLines.find((l) => /\d{4}|\d{1,2}\/\d{1,2}/.test(l)) || "";
	const couv = meta.couverture || {};
	const lignes = Array.isArray(couv.lignes) && couv.lignes.length ? couv.lignes : couverture.LIGNES_DEFAUT;
	const tableHeader = couv.titre || meta.acheteur || objet || titre;

	const zip = new AdmZip(fs.readFileSync(GABARIT));
	const doc = corpsWord(zip);
	const bodyMatch = doc.match(/<w:body>([\s\S]*)<\/w:body>/);
	const body = bodyMatch[1];

	const tblStart = body.indexOf("<w:tbl");
	const tblEnd = body.indexOf("</w:tbl>", tblStart) + "</w:tbl>".length;
	const sectStart = body.lastIndexOf("<w:sectPr");

	const coverXml = meta.sansCouverture
		? ""
		: fillCover(body.slice(0, tblStart), {
				objet,
				dateStr,
				sousTraitant: meta.sousTraitant,
				titre,
				mention: meta.mention,
				adresse: (lignes.find((l) => /^adresse$/i.test(l.label)) || {}).value,
			});
	const infoTable = meta.sansCouverture ? "" : tableauContacts(body.slice(tblStart, tblEnd), tableHeader, lignes);
	const sectPr = meta.sansCouverture ? body.slice(sectStart).replace(/<w:titlePg\/>/, "") : body.slice(sectStart);
	const entete = zip.getEntry("word/header1.xml");
	if (entete)
		zip.updateFile(
			entete,
			Buffer.from(
				zip
					.readAsText(entete)
					.replace("{{ENTETE}}", xmlEsc([titre, meta.acheteur || couv.titre].filter(Boolean).join(" · "))),
				"utf8",
			),
		);

	liensCollectes = [];
	const {
		xml: corpsXml,
		toc,
		bm,
	} = bodyToXml(bodyBlocks, {
		annexes: Array.isArray(meta.annexes) ? meta.annexes : [],
		figuresCorps: Array.isArray(meta.figuresCorps) ? meta.figuresCorps : [],
		zip,
		numeroter: meta.sansNumerotation !== true,
		ouvreLaPage: meta.sansCouverture === true,
	});
	ajouterLiens(zip, liensCollectes);
	const ann = annexesXml(zip, Array.isArray(meta.annexes) ? meta.annexes : [], bm, sectPr);
	const sommaire = meta.sansSommaire ? "" : sommaireXml([...toc, ...ann.toc]);
	const newBody = coverXml + infoTable + sommaire + corpsXml + ann.xml + ann.sectPr;
	const newDoc = doc.replace(/<w:body>[\s\S]*<\/w:body>/, `<w:body>${newBody}</w:body>`);
	zip.updateFile("word/document.xml", Buffer.from(newDoc, "utf8"));

	forceUpdateFields(zip);

	const numerote = await numeroterSommaire(zip, newDoc, [...toc, ...ann.toc]);
	if (numerote) zip.updateFile("word/document.xml", Buffer.from(numerote, "utf8"));
	return zip.toBuffer();
}

function forceUpdateFields(zip) {
	let s = zip.readAsText("word/settings.xml");
	if (!s) return;
	if (/<w:updateFields\b/.test(s)) s = s.replace(/<w:updateFields\b[^>]*>/, '<w:updateFields w:val="true"/>');
	else s = s.replace(/<w:settings\b[^>]*>/, (m) => `${m}<w:updateFields w:val="true"/>`);
	zip.updateFile("word/settings.xml", Buffer.from(s, "utf8"));
}

const titreDuDocument = (md) => couperCouverture(parseBlocks(stripFences(String(md == null ? "" : md)))).titre;

module.exports = {
	ajouterLiens,
	render,
	tailleRendue,
	plan,
	pagesDuSommaire,
	figureXml,
	titreDuDocument,
	chiffresCles,
	TITRE_DEFAUT,
};
