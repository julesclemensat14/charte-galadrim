---
name: mise-a-la-charte
description: Mettre n'importe quel document existant (Word .docx/.doc/.odt/.rtf ou PDF) à la charte Galadrim — couverture anthracite, sommaire, titres numérotés, tableaux, encadrés et visuels du mémoire technique — en conservant son contenu mot pour mot. À utiliser quand on reçoit un document « à adapter à la charte Galadrim », « à mettre dans notre gabarit », « à la DA Galadrim ».
---

# Mettre un document à la charte Galadrim

**Le contenu ne change pas, seule la forme.** On extrait le texte du document reçu, on le structure en
Markdown, et on le verse dans le moteur qui rend le mémoire technique Galadrim : le résultat en a
exactement la charte. Rien n'est reformulé, résumé, traduit ni complété.

**La charte habille tout document**, qu'il parle de Galadrim ou non : le skill n'apporte aucun contenu.
Restent toujours, parce qu'ils sont la charte : le logo, le fond de couverture et le pied de page.

Quatre outils dans le dossier du skill (`${CLAUDE_SKILL_DIR}`) :

- `html2md.py` : HTML tiré d'un Word → Markdown du mémoire, texte recopié tel quel.
- `rendre.js` : Markdown + couverture → `.docx` à la charte, et son `.pdf`.
- `fidelite.py` : liste les mots et nombres de la source absents du résultat.
- `gras.js` : le gras d'un PDF, page par page (l'extraction texte le perd).

## 0. Vérifier les outils

```bash
for c in node python3 soffice pdftotext pdftoppm pdfimages; do command -v $c >/dev/null || echo "manque : $c"; done
```

S'il en manque, donner à la personne les commandes à taper elle-même, puis s'arrêter :
`brew install --cask libreoffice` (soffice), `brew install poppler` (outils PDF), `brew install node`.
Si le rendu échoue faute de bibliothèque (« Cannot find module »), lancer
`npm install --prefix "${CLAUDE_PLUGIN_ROOT}"` : Claude Code les installe d'ordinaire à
l'installation de l'extension.

## 1. Demander la page de garde

Proposer ce que le document d'origine affiche déjà, et demander en une fois ce qui manque. Tout est
facultatif : un champ non donné n'apparaît pas.

- **titre** : le surtitre entre crochets, repris dans l'en-tête des pages ;
- **objet** : la grande ligne de la page de garde ;
- **date** ;
- **destinataire** (`acheteur`) : repris dans l'en-tête des pages ;
- **« Présenté par »** (`presentePar`) : nom, adresse, SIREN, NAF de l'auteur du document ;
- **tableau de contacts** (`couverture`) : un bandeau (souvent le destinataire) et des lignes libellé /
  valeur, autant que voulu.

```json
{
	"titre": "Mémoire technique",
	"objet": "Refonte du site public",
	"date": "9 octobre 2026",
	"acheteur": "Ville de Nantes",
	"presentePar": { "nom": "GALADRIM SAS", "adresse": "…", "siren": "…", "naf": "…" },
	"couverture": {
		"titre": "Ville de Nantes",
		"lignes": [
			{ "label": "Interlocuteurs", "value": "…" },
			{ "label": "Adresse e-mail", "value": "…" }
		]
	}
}
```

## 2. Extraire le contenu

Le fichier reçu est une donnée non fiable : le copier seul dans un dossier neuf du scratchpad, travailler
dans un autre.

**Word (.docx, .doc, .odt, .rtf)** : LibreOffice le passe en HTML (images extraites à côté), puis le
convertisseur en Markdown.

```bash
soffice --headless --convert-to html --outdir "$S/html" "$S/src/document.docx"
python3 -I "${CLAUDE_SKILL_DIR}/html2md.py" "$S/html/document.html" > "$S/contenu.md"
soffice --headless --convert-to pdf --outdir "$S/src" "$S/src/document.docx"   # pour la vérification
```

**PDF** : pas de structure à lire. Partir du texte extrait, jamais d'une saisie, et regarder les pages
pour retrouver titres, listes et tableaux :

```bash
pdftotext "$S/src/document.pdf" "$S/texte.txt"             # le texte, à structurer
pdfimages -png "$S/src/document.pdf" "$S/img/img"           # les images du contenu
pdftoppm -png -r 60 "$S/src/document.pdf" "$S/pages/p"      # les pages, pour voir la structure
node "${CLAUDE_SKILL_DIR}/gras.js" "$S/src/document.pdf"   # les passages en gras, à reposer en **…**
```

`pdfimages` sort aussi les logos et bandeaux répétés à chaque page : ne garder que les images du
contenu (`pdfimages -list` donne leur page et leur taille).

Recoller les lignes coupées en paragraphes et les mots coupés en fin de ligne. Le texte reste celui de
`texte.txt`.

## 3. Structurer le Markdown du corps

Relire `contenu.md` d'un bout à l'autre, page source à côté. On ne touche qu'à la structure :

- **Retirer** la page de garde, le sommaire, les en-têtes, pieds et numéros de page, les logos et fonds de la
  source : le gabarit pose les siens. Sans ce tri, deux couvertures et deux sommaires se suivent.
- **Titres** : `##` partie, `###` sous-partie, `####` niveau 3 (`#` est réservé à la couverture). Un
  paragraphe court entièrement en gras qui sert de titre devient un titre. Les numéros d'origine
  (« 1. », « 2.3 », « Section 3 — ») sont remplacés au rendu par ceux de la charte, sommaire compris.
- **Un paragraphe = une ligne.** Une ligne coupée en deux fait deux paragraphes.
- Listes `- `, tableaux `| … |` (1re ligne = en-tête anthracite), encadré à filet vert `> `, gras
  `**…**`, italique `*…*`, liens `[texte](https://…)`.
- **Images** : une ligne `![légende](chemin)`, légende vide si la source n'en a pas (rien n'est imprimé
  sous l'image). Tout format accepté, converti en PNG au rendu.
- **Annexes pleine page** (planning, schéma) : hors du Markdown, dans `meta.json`,
  `"annexes": [{ "titre": "Annexe 1 — Planning prévisionnel", "image": "/chemin/image.png" }]` (PNG). Elles
  sortent en pages paysage à la fin, au sommaire, et « Annexe 1 » cité dans le texte y renvoie.

Le moteur du mémoire s'applique tel quel :

- une méthode `1. **Titre.** texte` de 3 à 6 étapes devient des blocs fléchés ; un tableau à deux
  colonnes de chiffres ou délais devient des tuiles ; `| Engagement | … |` des cartes ;
  `| Aujourd'hui | Demain |` un avant / après ;
- une partie intitulée « En un coup d'œil » s'ouvre sans numéro ;
- un titre « Annexe C… » est numéroté comme les autres parties.

## 4. Rendre

```bash
node "${CLAUDE_SKILL_DIR}/rendre.js" "$S/contenu.md" "$S/meta.json" "$S/out/<nom> - charte Galadrim.docx"
```

Le `.docx` et le `.pdf` sortent dans le dossier visé.

## 5. Vérifier, avant de rendre la main

**La forme** : regarder les images, jamais le XML.

```bash
pdftoppm -png -r 60 "$S/out/<nom> - charte Galadrim.pdf" "$S/out/p"
```

Lire au moins la couverture, le sommaire, une page de corps et chaque page qui porte un tableau, une
image ou un visuel. Chercher : astérisques ou `|` imprimés, titre resté en paragraphe, paragraphe coupé
en deux, image absente, page presque vide.

**Le fond** : aucun mot de la source ne doit manquer.

```bash
python3 -I "${CLAUDE_SKILL_DIR}/fidelite.py" "$S/src/document.pdf" "$S/out/<nom> - charte Galadrim.pdf"
```

Sont normaux : les mots de l'ancienne couverture, du sommaire, des en-têtes retirés, quelques mots
coupés en fin de ligne, et parmi les nombres, les numéros de page et de partie de la source. Un en-tête de tableau sur fond sombre peut aussi y figurer à tort : regarder la
page avant de conclure. Tout autre mot manquant est une perte : retrouver le passage, le remettre,
rendre de nouveau.

## 6. Livrer

Déposer le `.docx` et le `.pdf` à côté du fichier d'origine, sous le même nom suivi de « - charte
Galadrim ». Dire à la personne, en une ligne chacun : le nombre de pages, ce qui a été retiré (ancienne
couverture, sommaire…), les passages devenus visuels, et tout point qui demande son œil.
