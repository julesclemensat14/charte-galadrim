// Rend un contenu Markdown dans le gabarit du mémoire technique (templates/reference.docx), puis en PDF.
// Usage : node rendre.js contenu.md meta.json sortie.docx
//
// contenu.md : le CORPS seul (« ## » = titre de partie), la couverture vient de meta.json. Une ligne
// ![légende](image) devient une figure du gabarit (carte blanche), sans légende imprimée si elle est vide.
// meta.json : { titre, objet, acheteur, date, presentePar: { nom, adresse, siren, naf },
// couverture: { titre, lignes: [{ label, value }] }, annexes }, passé au moteur du mémoire (docxtemplate.render).
//
// La charte habille tout document, Galadrim ou non : rien n'est prérempli. Sans `presentePar`, la page de
// garde n'a pas de bloc « Présenté par » ; sans `couverture`, pas de tableau de contacts.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const AdmZip = require("adm-zip");
// Dans le projet, le moteur de l'outil ; dans le skill distribué (scripts/publier-charte.sh), sa copie
// embarquée dans moteur/.
const MOTEUR = fs.existsSync(path.join(__dirname, "moteur")) ? "./moteur/server/" : "../../../server/";
const { render } = require(`${MOTEUR}docxtemplate`);
const identite = require(`${MOTEUR}identite`);

(async () => {
	const [md, metaJson, sortie] = process.argv.slice(2);
	if (!sortie) throw new Error("usage : rendre.js contenu.md meta.json sortie.docx");
	const meta = JSON.parse(fs.readFileSync(metaJson, "utf8"));
	const dossier = path.dirname(path.resolve(sortie));
	// Le moteur lit le bloc « Présenté par » dans la fiche d'identité de l'outil : on la remplace par ce qui
	// a été donné. L'adresse passe en siège, que les tuiles de chiffres clés ne lisent pas.
	const p = meta.presentePar || {};
	identite.parse = () => ({ denomination: p.nom, adresseSiege: p.adresse, siren: p.siren, ape: p.naf });

	// Le moteur ne pose que des PNG, appariés au corps par le texte de leur légende.
	const figuresCorps = [];
	const corps = fs.readFileSync(md, "utf8").replace(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/gm, (_, legende, image) => {
		const n = figuresCorps.length + 1;
		if (!/\.png$/i.test(image)) {
			const png = path.join(dossier, `image-${n}.png`);
			execFileSync("sips", ["-s", "format", "png", image, "--out", png], { stdio: "ignore" });
			image = png;
		}
		const cle = legende.trim() || `⟦image ${n}⟧`;
		figuresCorps.push({ legende: cle, image, muette: !legende.trim() });
		return cle;
	});

	// Une 1re ligne « # » et « ## » seraient lues comme titre et objet de couverture : on les pose ici,
	// et meta.json les remplace par ce qui a été donné.
	// Sans contacts donnés, une ligne vide : le moteur prendrait sinon son tableau par défaut, et son adresse.
	const couverture = meta.couverture || { titre: "", lignes: [{ label: "", value: "" }] };
	const zip = new AdmZip(
		await render(`# couverture\n## couverture\n---\n${corps}`, {
			...meta,
			objet: meta.objet || "",
			couverture,
			figuresCorps,
		}),
	);
	// Ce que le moteur pose toujours sur la page de garde et qui n'a pas été donné : le bloc « Présenté par »
	// (de son libellé jusqu'à la date, dernier paragraphe) et le tableau de contacts (1er tableau).
	let xml = zip.readAsText("word/document.xml");
	const debutTableau = xml.indexOf("<w:tbl");
	let garde = xml.slice(0, debutTableau);
	const debutParagraphe = (i) => Math.max(garde.lastIndexOf("<w:p>", i), garde.lastIndexOf("<w:p ", i));
	if (!p.nom)
		garde =
			garde.slice(0, debutParagraphe(garde.indexOf(">Présenté par<"))) + garde.slice(debutParagraphe(garde.length));
	const finTableau = xml.indexOf("</w:tbl>", debutTableau) + "</w:tbl>".length;
	xml = garde + (meta.couverture ? xml.slice(debutTableau, finTableau) : "") + xml.slice(finTableau);
	zip.updateFile("word/document.xml", Buffer.from(xml, "utf8"));
	zip.writeZip(sortie);
	// Profil LibreOffice à part : sans lui, la conversion échoue en silence si LibreOffice est ouvert.
	const profil = fs.mkdtempSync(path.join(os.tmpdir(), "charte_lo_"));
	execFileSync(
		"soffice",
		[`-env:UserInstallation=file://${profil}`, "--headless", "--convert-to", "pdf", "--outdir", dossier, sortie],
		{ stdio: "ignore" },
	);
	console.log(`${sortie}\n${sortie.replace(/\.docx$/, ".pdf")}`);
})();
