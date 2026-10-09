# Charte Galadrim

Une extension Claude Code qui met n'importe quel document Word ou PDF à la charte Galadrim :
couverture anthracite, sommaire, titres numérotés, tableaux, encadrés, annexes en paysage. Le contenu
reste mot pour mot celui du document d'origine. Une vérification liste tout mot qui manquerait.

Ce dépôt est assemblé depuis l'outil de réponse aux appels d'offres. Ne pas le modifier à la main :
la prochaine publication écraserait la modification.

## Avant de commencer : ce qu'il faut sur le Mac

| Outil           | À quoi il sert                                          |
| --------------- | ------------------------------------------------------- |
| **Claude Code** | fait la conversion ; l'extension s'installe dedans      |
| **Homebrew**    | installe les trois outils suivants                      |
| **LibreOffice** | lit les Word et produit le PDF final                    |
| **Outils PDF**  | lisent le texte, les images et les pages des PDF        |
| **Node**        | fait tourner la mise en page ; requis avant l'extension |

Pour voir ce qui manque déjà, dans un terminal :

```bash
for c in claude brew soffice pdftotext node; do command -v $c >/dev/null || echo "manque : $c"; done
```

Aucune ligne affichée : tout est là, passer à « Installer ».

## Installer (une fois)

1. **Claude Code**, s'il manque : suivre https://code.claude.com/docs, puis lancer `claude` une fois pour
   se connecter.
2. **Homebrew**, s'il manque (commande donnée sur https://brew.sh) :

   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```

   Suivre les dernières lignes qu'il affiche (« Next steps ») pour rendre la commande `brew` disponible.

3. **LibreOffice, les outils PDF et Node**, dans cet ordre, avant l'extension :

   ```bash
   brew install --cask libreoffice
   brew install poppler node
   ```

4. **L'extension** :

   ```bash
   claude plugin marketplace add julesclemensat14/charte-galadrim
   claude plugin install charte-galadrim@charte-galadrim --scope user
   ```

## Utiliser

Dans Claude Code, n'importe où :

```
/charte-galadrim:mise-a-la-charte ~/Desktop/mon-document.pdf
```

Claude propose et demande les informations de la page de garde (titre, objet, date, contacts), puis
dépose le Word et le PDF à côté du document d'origine.

## Mettre à jour

Quand la charte change :

```bash
claude plugin marketplace update charte-galadrim
claude plugin update charte-galadrim@charte-galadrim
```

Puis `/reload-plugins` dans une session ouverte.
