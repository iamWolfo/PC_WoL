# Wakebase

Application Wake-on-LAN pour réveiller et administrer des PC à distance via PostgreSQL.

## Lancer la démo

Installer les dépendances puis démarrer l’API :

```bash
npm install
npm start
```

Puis ouvrir `http://localhost:3000`.

Le serveur lit automatiquement les variables `POSTGRESQL_ADDON_URI` (ou les variables PostgreSQL individuelles) depuis `.env`, crée les tables au premier démarrage et expose l’interface ainsi que l’API.

## Fonctionnalités connectées

- Inscription et connexion avec mot de passe haché.
- Appareils stockés par utilisateur dans PostgreSQL.
- Journal d’activité persistant.
- Envoi du paquet magique depuis le serveur via l’adresse de broadcast du routeur.

## Déploiement

Le serveur qui exécute Node.js doit pouvoir atteindre le réseau local du PC cible. Une base PostgreSQL distante seule ne suffit pas pour le Wake-on-LAN : le processus Node doit être placé sur le LAN, derrière un VPN, ou relié à un agent local.

Les secrets de `.env` ne doivent jamais être commités. Si les identifiants PostgreSQL ont été partagés publiquement, ils doivent être renouvelés.