# Charte Galadrim

Une extension Claude Code qui met n'importe quel document Word ou PDF à la charte Galadrim :
couverture anthracite, sommaire, titres numérotés, tableaux, encadrés, annexes en paysage. Le contenu
reste mot pour mot celui du document d'origine. Une vérification liste tout mot qui manquerait.

Ce dépôt est assemblé depuis l'outil de réponse aux appels d'offres. Ne pas le modifier à la main :
la prochaine publication écraserait la modification.

## Installer (une fois, sur Mac)

1. Installer les outils dans un terminal :

   ```bash
   brew install --cask libreoffice
   brew install poppler node
   ```

2. Installer l'extension :

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
