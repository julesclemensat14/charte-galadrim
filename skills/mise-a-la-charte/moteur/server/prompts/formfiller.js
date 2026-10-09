// Remplace server/prompts/formfiller.js dans le skill distribué : le moteur du mémoire et rendre.js n'en
// prennent que la conversion en PDF. Même contrat que l'original : le PDF en Buffer, ou null.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

async function toPdf(src) {
	const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "charte_lo_"));
	try {
		// Profil LibreOffice à part : sans lui, la conversion échoue en silence si LibreOffice est ouvert.
		execFileSync(
			"soffice",
			[
				"--headless",
				"--norestore",
				`-env:UserInstallation=file://${path.join(dossier, "profil")}`,
				"--convert-to",
				"pdf",
				"--outdir",
				dossier,
				src,
			],
			{ stdio: "ignore" },
		);
		return fs.readFileSync(path.join(dossier, path.basename(src).replace(/\.[^.]+$/, ".pdf")));
	} catch {
		return null;
	} finally {
		fs.rmSync(dossier, { recursive: true, force: true });
	}
}

module.exports = { toPdf };
